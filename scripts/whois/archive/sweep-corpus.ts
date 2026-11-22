#!/usr/bin/env tsx
// Corpus-completion sweep (docs/archive/whois-parser-refactor.md P0). The Tranco-driven
// gathering that built fixtures/found/ covered the popular slice: 790 of 1,141 routed
// whois servers and 792 of 1,443 TLDs have at least one found-fixture. The parser
// rewrite's clustering (P2) and its A/B gate (P1) need the WHOLE space — a format we
// have no fixture for is a format we cannot cluster, port, or regress-test.
//
// This gathers >=1 found-fixture for every TLD and every server currently lacking one.
// Probe query per target: `nic.<tld>` first (contractually registered for new gTLDs,
// usually present elsewhere), then known-registered fallbacks from the Tranco name list
// (scripts/whois/data/tranco-names.json).
//
// Runs through the library client (scripts/lib/client.ts), so each server's own query
// string and the proxy apply, same as check-servers/refresh-fixtures. Politeness: servers are swept in
// parallel but each server's own candidates run SEQUENTIALLY on one worker with pacing,
// so no registry ever sees concurrent connections from us.
//
// GOLDEN POLICY (important, and the reason this script is not just "record everything").
// A golden .json here would be written by the CURRENT engine, so recording one for a
// response the current engine cannot parse would bake "null is correct" into the corpus
// — and the rewrite would then score its own improvements as regressions. Worse, a
// response the current engine parses to nothing is ambiguous in a way this engine cannot
// resolve: it is either a format we can't parse (belongs in found/) or an error/notfound
// page whose pattern we don't recognize (belongs in notfound/). Observed in the first
// batch: Identity Digital answers an unserved TLD with `TLD is not supported.`, which no
// current notfound regex matches. So:
//   - a credible parse (domainName + >=GOLDEN_MIN_OTHER other required fields)
//     → fixtures/found/ with a golden .json
//   - anything else → fixtures/unclassified/ raw .txt only, never found/
// The unclassified holding pen is the P0 prioritization worklist and P1's triage input:
// once the new engine has anchored meta (docs/archive/whois-parser-refactor.md §4) it can decide
// each one, and they graduate to found/ or notfound/. Coverage counts found/ only, so
// these never inflate the numbers.
//
// Run: npm run whois:sweep-corpus [--limit N] [--server host]
//      [--tld tld] [--dry-run] [--retry-failed]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DOMAIN_REQUIRED_FIELDS } from '../../../src/whois/base';
import { addRawMetadata } from '../lib/raw';
import { toolingClient } from '../../lib/client';
import { getTldServers } from '../generate-tlds';
import { runPool } from '../../registry-health/state';
import { HEALTH_DIR, TRANCO_NAMES_FILE, WHOIS_FIXTURES_DIR } from '../../lib/paths';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;
const NOTFOUND_DIR = `${WHOIS_FIXTURES_DIR}notfound/`;
const UNCLASSIFIED_DIR = `${WHOIS_FIXTURES_DIR}unclassified/`;
const SWEEP_FILE = `${HEALTH_DIR}corpus-sweep.json`;

// how many query candidates to try per target before giving up (nic.<tld> + fallbacks).
// Each costs a live query against a registry that may be rate-limiting us.
const MAX_CANDIDATES = 3;
// a golden is only credible if domainName parsed AND this many other required fields did
const GOLDEN_MIN_OTHER = 3;

const CONCURRENCY = 6;
const PACE_MS = 400; // between servers on a worker
const CANDIDATE_PACE_MS = 1500; // between candidates against the SAME server
const QUERY_TIMEOUT_MS = 10000;

type Outcome = 'found' | 'unclassified' | 'notfound' | 'throttled' | 'dead' | 'error';

type TargetResult = {
  tld: string;
  server: string;
  query: string | null;
  outcome: Outcome;
  golden: boolean;
  detail?: string;
};

type SweepReport = {
  sweptAt: string;
  coverage: { before: Coverage; after: Coverage };
  results: TargetResult[];
};

type Coverage = {
  tldsTotal: number;
  tldsRouted: number;
  tldsCovered: number;
  serversRouted: number;
  serversCovered: number;
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

// The TLD a query belongs to: the LONGEST known TLD the name ends with, not the last
// label. The routed map includes second-level pseudo-TLDs from tlds-extra.json (uk.com,
// ac.za, co.ua, …), so `nic.ac.uk` belongs to `ac.uk`, not to `uk`. Taking the last label
// silently marked every pseudo-TLD uncovered forever: its found-fixtures counted toward
// the wrong TLD, so it stayed a target and got re-swept (and re-queried) on every run.
function tldOf(query: string, known: Set<string>): string | null {
  const labels = query.toLowerCase().split('.');
  for (let i = 1; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (known.has(candidate)) return candidate;
  }
  return null;
}

// what the corpus covers today: servers and TLDs with >=1 found-fixture .txt
function readCorpus(known: Set<string>): { servers: Set<string>; tlds: Set<string> } {
  const servers = new Set<string>();
  const tlds = new Set<string>();
  for (const file of readdirSync(FOUND_DIR)) {
    if (!file.endsWith('.txt') || !file.includes('___')) continue;
    const [server, query] = file.replace(/\.txt$/, '').split('___');
    if (server) servers.add(server.toLowerCase());
    const tld = query ? tldOf(query, known) : null;
    if (tld) tlds.add(tld);
  }
  return { servers, tlds };
}

function measureCoverage(tldServers: Record<string, string | null>): Coverage {
  const { servers, tlds } = readCorpus(new Set(Object.keys(tldServers)));
  const routedTlds = Object.entries(tldServers).filter(([, s]) => Boolean(s));
  const routedServers = new Set(routedTlds.map(([, s]) => s!.toLowerCase()));
  return {
    tldsTotal: Object.keys(tldServers).length,
    tldsRouted: routedTlds.length,
    tldsCovered: routedTlds.filter(([tld]) => tlds.has(tld)).length,
    serversRouted: routedServers.size,
    serversCovered: [...routedServers].filter(s => servers.has(s)).length,
  };
}

// query candidates for a TLD, best-first: nic.<tld> then known-registered Tranco names.
// De-duplicated, since tranco-names.json already lists nic.<tld> for many TLDs.
function candidatesFor(tld: string, tranco: Record<string, string[]>): string[] {
  const names = [`nic.${tld}`, ...(tranco[tld] ?? [])];
  return [...new Set(names.map(n => n.toLowerCase()))].slice(0, MAX_CANDIDATES);
}

// a parse is credible enough to freeze as a golden only if the engine actually understood
// the response — see GOLDEN POLICY above.
function isCredibleParse(data: Record<string, unknown>): boolean {
  if (!data.domainName) return false;
  const others = DOMAIN_REQUIRED_FIELDS.filter(f => f !== 'domainName').filter(f => {
    const value = data[f];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
  return others.length >= GOLDEN_MIN_OTHER;
}

const client = toolingClient();

// try one candidate query against one server; write fixtures on success
async function tryCandidate(tld: string, server: string, query: string): Promise<TargetResult> {
  const base: TargetResult = { tld, server, query, outcome: 'error', golden: false };
  try {
    const [hop] = await client.whois(query, {
      server,
      followReferrals: 0,
      timeout: QUERY_TIMEOUT_MS,
    });
    if (!hop?.raw) return { ...base, outcome: 'error', detail: 'no raw response' };
    const result = {
      raw: addRawMetadata(query, server, new Date().toISOString(), hop.raw),
      status: hop.status,
    };

    const name = `${server}___${query}`;
    // notfound/reserved — still a real response from a live server, so it earns its place
    // in the notfound corpus (the P1 negative-case lane)
    if (result.status === 'notfound' || result.status === 'reserved') {
      const path = `${NOTFOUND_DIR}${name}.txt`;
      if (!existsSync(path)) writeFileSync(path, result.raw, 'utf8');
      return { ...base, outcome: 'notfound', detail: result.status };
    }

    // a response the current engine can't make sense of is ambiguous (unparsed format vs
    // unrecognized error page) — hold it aside rather than assert it into found/
    const data = (hop.data ?? {}) as Record<string, unknown>;
    if (!isCredibleParse(data)) {
      writeFileSync(`${UNCLASSIFIED_DIR}${name}.txt`, result.raw, 'utf8');
      return { ...base, outcome: 'unclassified', detail: 'no credible parse' };
    }

    writeFileSync(`${FOUND_DIR}${name}.txt`, result.raw, 'utf8');
    writeFileSync(
      `${FOUND_DIR}${name}.json`,
      JSON.stringify({ query, server, ...data }, null, 2) + '\n',
      'utf8'
    );
    return { ...base, outcome: 'found', golden: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : '';
    const outcome: Outcome = /RateLimit/.test(name)
      ? 'throttled'
      : /Timeout|Connection|Proxy/.test(name)
        ? 'dead'
        : 'error';
    return { ...base, outcome, detail: message };
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const onlyServer = getFlag('server');
  const onlyTld = getFlag('tld');
  const dryRun = process.argv.includes('--dry-run');
  const retryFailed = process.argv.includes('--retry-failed');

  // routing truth, same merged map prod and check-servers use (ascii ← extra ← auto ←
  // discovered ← phaseout ← overrides) — a phased-out TLD has no server to sweep, and
  // the extra pseudo-TLDs (uk.com, …) are real corpus targets tlds-ascii.json can't see
  const tldServers = getTldServers();
  for (const dir of [FOUND_DIR, NOTFOUND_DIR, UNCLASSIFIED_DIR])
    mkdirSync(dir, { recursive: true });
  const tranco = loadJson<Record<string, string[]>>(TRANCO_NAMES_FILE, {});
  const before = measureCoverage(tldServers);
  const { servers: haveServer, tlds: haveTld } = readCorpus(new Set(Object.keys(tldServers)));

  // previously-swept targets we've exhausted: skip by default so repeat runs spend their
  // queries on new ground. Only DETERMINISTIC outcomes retire a target — we tried every
  // candidate name and the registry answered "no such domain" (notfound), or answered
  // something we can't classify (already banked in unclassified/). A `dead`/`throttled`
  // outcome is transient (rotating-proxy HostUnreachable, rate limit) and must be retried
  // next run, or one flaky minute would drop a server from the corpus permanently.
  const previous = loadJson<SweepReport | null>(SWEEP_FILE, null);
  const EXHAUSTED_OUTCOMES: Outcome[] = ['notfound', 'unclassified'];
  const exhausted = new Set(
    retryFailed || !previous
      ? []
      : previous.results
          .filter(r => EXHAUSTED_OUTCOMES.includes(r.outcome))
          .map(r => `${r.server}___${r.tld}`)
  );

  // a target is any routed TLD whose TLD or whose server still lacks a found-fixture
  let targets = Object.entries(tldServers)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([tld, server]) => ({ tld, server: server.toLowerCase() }))
    .filter(t => !haveTld.has(t.tld) || !haveServer.has(t.server))
    .filter(t => !exhausted.has(`${t.server}___${t.tld}`))
    .filter(t => (onlyServer ? t.server === onlyServer : true))
    .filter(t => (onlyTld ? t.tld === onlyTld : true))
    .sort((a, b) => a.tld.localeCompare(b.tld));
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `coverage before: ${before.tldsCovered}/${before.tldsRouted} routed TLDs, ` +
      `${before.serversCovered}/${before.serversRouted} servers have a found-fixture`
  );
  console.log(
    `${targets.length} targets to sweep${exhausted.size ? ` (${exhausted.size} skipped as previously exhausted; --retry-failed to re-try)` : ''}`
  );
  if (dryRun) {
    for (const t of targets.slice(0, 40)) console.log(`  ${t.tld} → ${t.server}`);
    if (targets.length > 40) console.log(`  …and ${targets.length - 40} more`);
    process.exit(0);
  }

  // group by server so one worker owns a server: its candidates run sequentially, and no
  // registry sees two concurrent connections from us
  const byServer = new Map<string, Array<{ tld: string; server: string }>>();
  for (const t of targets) {
    const list = byServer.get(t.server) ?? [];
    list.push(t);
    byServer.set(t.server, list);
  }

  const results: TargetResult[] = [];
  let done = 0;
  await runPool([...byServer.values()], CONCURRENCY, PACE_MS, async group => {
    for (const { tld, server } of group) {
      const candidates = candidatesFor(tld, tranco);
      if (!candidates.length) {
        results.push({
          tld,
          server,
          query: null,
          outcome: 'error',
          golden: false,
          detail: 'no candidate name',
        });
        continue;
      }
      for (const [index, query] of candidates.entries()) {
        const result = await tryCandidate(tld, server, query);
        // a found response ends this target; anything else falls through to the next
        // candidate (a notfound usually means the probe name simply isn't registered)
        if (result.outcome === 'found' || index === candidates.length - 1) {
          results.push(result);
          break;
        }
        // throttled: this server won't answer more right now, don't burn its budget
        if (result.outcome === 'throttled' || result.outcome === 'dead') {
          results.push(result);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, CANDIDATE_PACE_MS));
      }
      if (++done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  });

  const after = measureCoverage(tldServers);
  mkdirSync(HEALTH_DIR, { recursive: true });
  const report: SweepReport = {
    sweptAt: new Date().toISOString(),
    coverage: { before, after },
    // merge with prior results so the exhausted set accumulates across runs
    results: [
      ...(previous?.results ?? []).filter(
        p => !results.some(r => r.server === p.server && r.tld === p.tld)
      ),
      ...results,
    ].sort((a, b) => `${a.tld}${a.server}`.localeCompare(`${b.tld}${b.server}`)),
  };
  writeFileSync(SWEEP_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const counts: Partial<Record<Outcome, number>> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;

  console.log(
    `\nswept ${results.length} targets in ${Math.round((Date.now() - started) / 1000)}s:`
  );
  for (const [outcome, count] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${outcome}: ${count}`);
  }
  if (counts.unclassified) {
    console.log(
      `\n${counts.unclassified} unclassified (live response, no credible parse) → fixtures/unclassified/`
    );
    console.log(`  the rewrite's worklist: either a format we can't parse, or an error page`);
    console.log(`  whose pattern we don't recognize. P1's anchored meta decides which.`);
  }
  console.log(
    `\ncoverage after: ${after.tldsCovered}/${after.tldsRouted} routed TLDs ` +
      `(+${after.tldsCovered - before.tldsCovered}), ` +
      `${after.serversCovered}/${after.serversRouted} servers (+${after.serversCovered - before.serversCovered})`
  );
  console.log(`report: registry-health/corpus-sweep.json`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
