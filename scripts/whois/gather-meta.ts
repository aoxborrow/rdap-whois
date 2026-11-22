#!/usr/bin/env tsx
// Meta-fixture gathering (docs/archive/whois-parser-refactor.md P2.5). P1's negative-case lane
// found that anchored meta RECALL is the new engine's weakest part, and that our own
// notfound/reserved/throttled corpus can't measure it honestly — those dirs were labelled
// BY the old engine's patterns, so they score it 100% by construction (§6b finding 2). The
// only unbiased signal today is the vendored corpus, which validates the ENGINE but not
// today's PATTERNS (P1 staleness rule). So we need LIVE reserved/throttled/servfail
// fixtures — and unlike `found`, these three don't fall out of a normal query. This gathers
// them. Three independent lanes, run per the flags:
//
//   reserved     (live, DEFAULT)  — probe names a registry is known to WITHHOLD (ICANN
//                  Spec-5 `example.<tld>`, single/two-char labels, nic/www), confirm the
//                  response trips the format's anchored `reserved` meta, bank it. Responses
//                  that are clearly withheld-shaped but the pattern DIDN'T catch are the
//                  P3 mining worklist — reported, not banked (banking an unconfirmed page
//                  as reserved would relabel the corpus by guess).
//   servfail     (offline, DEFAULT) — promote the fixtures/unclassified/ files whose
//                  anchored `servfail` already fires (§6b finding 3: Identity Digital's
//                  `TLD is not supported.` family) into fixtures/servfail/.
//   throttled    (live, GATED behind --gather-throttled + a hard per-server cap) — the ONLY
//                  lane that is deliberately impolite: it bursts a server past its rate
//                  limit to capture the throttle page. NEVER part of a routine run; the
//                  server set and cap are an owner decision (P2.5).
//
// All live queries run through the library client (scripts/lib/client.ts), so the proxy
// and each server's own query string apply — same as sweep-corpus/check-servers. Every
// banked response gets the ###%%% QRY/SRV/TME header (addRawMetadata), so each fixture
// keeps its live-probe timestamp (P2.5: a pattern only counts as verified once a live
// probe confirms it).
//
// This touches NO runtime engine and NO golden — it only writes fixture .txt files and a
// report. The old engine stays frozen until P4.
//
// Run: npm run whois:gather-meta [--reserved] [--servfail]
//      [--limit N] [--server host] [--dry-run]
//      [--gather-throttled --throttle-servers a,b,c [--max-per-server N]]
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { DOMAIN_REQUIRED_FIELDS } from '../../src/whois/base';
import { RateLimitError, type RdapWhois } from '../../src/index';
import { detectMeta } from '../../src/whois/mapping';
import { getFormat, type MetaKind } from '../../src/whois/formats';
import { getTldServers } from './generate-tlds';
import { addRawMetadata, stripRawMetadata } from './lib/raw';
import { toolingClient } from '../lib/client';
import { runPool } from '../registry-health/state';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';

const FIXTURES = WHOIS_FIXTURES_DIR;
const RESERVED_DIR = `${FIXTURES}reserved/`;
const SERVFAIL_DIR = `${FIXTURES}servfail/`;
const THROTTLED_DIR = `${FIXTURES}throttled/`;
const UNCLASSIFIED_DIR = `${FIXTURES}unclassified/`;
const REPORT_FILE = `${HEALTH_DIR}gather-meta.json`;

// meta is format-level; generic-kv inherits icann's patterns (formats.ts), so it is
// the widest net and the right one to confirm against — same choice as check-meta.
const FORMAT = getFormat('generic-kv');

// probe labels a registry is known to withhold, best-first. `example` is ICANN-reserved at
// the second level in EVERY gTLD (Registry Agreement Spec 5 §3) → the highest-yield gTLD
// probe; single/two-char labels and nic/www cover the ccTLDs that don't follow Spec 5.
const RESERVED_LABELS = ['example', 'a', 'ab', 'nic', 'www'];
const MAX_RESERVED_CANDIDATES = 3;

const CONCURRENCY = 6;
const PACE_MS = 400; // between servers on a worker
const CANDIDATE_PACE_MS = 1500; // between candidates against the SAME server (politeness)
const QUERY_TIMEOUT_MS = 10000;

// throttled lane: how many rapid-fire queries to a single server before giving up if the
// throttle page never appears. A hard ceiling so a mis-targeted burst can't run away.
const THROTTLE_CAP_DEFAULT = 8;
const THROTTLE_BURST_PACE_MS = 150; // deliberately fast — the point is to trip the limit

type Classification = 'registered' | 'notfound' | 'reserved' | 'suspected' | 'error';

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

// a credible domain parse = the probe name is actually REGISTERED (or the registry's own),
// so it is not a withheld/reserved response — skip it. Same bar as the sweep's golden test.
function isRegistered(data: Record<string, unknown>): boolean {
  if (!data.domainName) return false;
  const others = DOMAIN_REQUIRED_FIELDS.filter(f => f !== 'domainName').filter(f => {
    const value = data[f];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
  return others.length >= 3;
}

// first few non-notice, non-metadata lines — enough for a human/AI to author the missing
// reserved pattern in P3 without banking the whole (unconfirmed) page as a golden.
function snippet(raw: string): string {
  return stripRawMetadata(raw)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^[%#*]/.test(l) && !/^>>>/.test(l))
    .slice(0, 6)
    .join(' ⏎ ');
}

// ── reserved lane ──────────────────────────────────────────────────────────────────────

type ReservedHit = {
  server: string;
  query: string;
  kind: 'reserved' | 'suspected';
  snippet: string;
};

// one server's own answer, with the fixture header above it, or null when it gave none
async function queryRaw(
  client: RdapWhois,
  server: string,
  query: string,
  retries?: number
): Promise<{ raw: string; data: Record<string, unknown> } | null> {
  const [hop] = await client.whois(query, {
    server,
    followReferrals: 0,
    timeout: QUERY_TIMEOUT_MS,
    ...(retries === undefined ? {} : { retries }),
  });
  if (!hop?.raw) return null;
  return {
    raw: addRawMetadata(query, server, new Date().toISOString(), hop.raw),
    data: (hop.data ?? {}) as Record<string, unknown>,
  };
}

const client = toolingClient();

async function probeReserved(
  server: string,
  query: string
): Promise<{ cls: Classification; hit?: ReservedHit }> {
  try {
    const result = await queryRaw(client, server, query);
    if (!result) return { cls: 'error' };

    const meta = detectMeta(result.raw, FORMAT);
    const kinds = Object.keys(meta) as MetaKind[];

    // anchored reserved fires → confirmed, bank it (live + timestamped)
    if (kinds.includes('reserved')) {
      const path = `${RESERVED_DIR}${server}___${query}.txt`;
      if (!existsSync(path)) writeFileSync(path, result.raw, 'utf8');
      return {
        cls: 'reserved',
        hit: { server, query, kind: 'reserved', snippet: snippet(result.raw) },
      };
    }
    // any OTHER meta fired (notfound → probe simply unregistered here; servfail → wrong
    // server for the TLD; throttled → rate-limited) — the engine recognized the response, it
    // just isn't reserved. Not a hit, and NOT a reserved suspect (the suspect bucket is only
    // for pages the engine recognized as NOTHING).
    if (kinds.length) return { cls: 'notfound' };

    const data = result.data;
    if (isRegistered(data)) return { cls: 'registered' };

    // known-withheld probe, no credible parse, no clean notfound, anchored reserved DIDN'T
    // fire → very likely a reserved page whose pattern we don't recognize yet. The P3
    // worklist. Reported (with a snippet), NOT banked — banking by guess would relabel the
    // corpus and let the rewrite score its own unconfirmed guesses.
    return {
      cls: 'suspected',
      hit: { server, query, kind: 'suspected', snippet: snippet(result.raw) },
    };
  } catch {
    return { cls: 'error' };
  }
}

async function gatherReserved(
  limit: number | undefined,
  onlyServer: string | undefined,
  dryRun: boolean
): Promise<{ confirmed: ReservedHit[]; suspected: ReservedHit[]; before: number; after: number }> {
  mkdirSync(RESERVED_DIR, { recursive: true });
  // one server per routed TLD; skip servers that already have a reserved fixture (diversity
  // over depth — one live reserved response per operator is what validates a pattern)
  const haveReserved = new Set(
    readdirSync(RESERVED_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => f.slice(0, f.indexOf('___')).toLowerCase())
  );
  const before = haveReserved.size;

  const servers = new Map<string, string>(); // server → probe TLD
  for (const [tld, server] of Object.entries(getTldServers())) {
    if (!server) continue;
    const key = server.toLowerCase();
    if (haveReserved.has(key)) continue;
    if (onlyServer && key !== onlyServer) continue;
    if (!servers.has(key)) servers.set(key, tld);
  }
  let targets = [...servers.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `reserved: ${before} servers already covered; ${targets.length} to probe` +
      `${limit ? ` (--limit ${limit})` : ''}`
  );
  if (dryRun) {
    for (const [server, tld] of targets.slice(0, 40))
      console.log(`  ${server} ← example.${tld}, …`);
    return { confirmed: [], suspected: [], before, after: before };
  }

  const confirmed: ReservedHit[] = [];
  const suspected: ReservedHit[] = [];
  let done = 0;
  await runPool(targets, CONCURRENCY, PACE_MS, async ([server, tld]) => {
    const candidates = RESERVED_LABELS.slice(0, MAX_RESERVED_CANDIDATES).map(l => `${l}.${tld}`);
    for (const [index, query] of candidates.entries()) {
      const { cls, hit } = await probeReserved(server, query);
      if (cls === 'reserved' && hit) {
        confirmed.push(hit);
        break; // one confirmed reserved fixture per server is enough
      }
      if (hit?.kind === 'suspected' && !suspected.some(s => s.server === server))
        suspected.push(hit);
      if (index < candidates.length - 1) await new Promise(r => setTimeout(r, CANDIDATE_PACE_MS));
    }
    if (++done % 25 === 0) console.log(`  ${done}/${targets.length}`);
  });

  const after = new Set(
    readdirSync(RESERVED_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => f.slice(0, f.indexOf('___')).toLowerCase())
  ).size;
  return { confirmed, suspected, before, after };
}

// ── servfail lane (offline promotion) ────────────────────────────────────────────────────

function promoteServfail(dryRun: boolean): { promoted: string[] } {
  const promoted: string[] = [];
  if (!existsSync(UNCLASSIFIED_DIR)) return { promoted };
  mkdirSync(SERVFAIL_DIR, { recursive: true });
  for (const file of readdirSync(UNCLASSIFIED_DIR).filter(f => f.endsWith('.txt'))) {
    const raw = readFileSync(UNCLASSIFIED_DIR + file, 'utf8');
    const kinds = Object.keys(detectMeta(raw, FORMAT)) as MetaKind[];
    // ONLY servfail — a file that also (or only) trips notfound/reserved is not
    // unambiguously an error page and stays in triage for the sweep/P3 to resolve
    if (kinds.length === 1 && kinds[0] === 'servfail') {
      promoted.push(file);
      if (!dryRun) renameSync(UNCLASSIFIED_DIR + file, SERVFAIL_DIR + file);
    }
  }
  return { promoted };
}

// ── throttled lane (gated, deliberately impolite) ────────────────────────────────────────

async function gatherThrottled(
  serverList: string[],
  cap: number,
  dryRun: boolean
): Promise<{ server: string; captured: boolean; queries: number }[]> {
  mkdirSync(THROTTLED_DIR, { recursive: true });
  const out: { server: string; captured: boolean; queries: number }[] = [];
  // the per-server spacing would keep the burst under the very limit this lane sets out to
  // trip, so it is off here; the burst's own pace and cap bound it instead
  const burstClient = toolingClient({ concurrency: 1, minInterval: 0 });
  // sequential across servers AND bounded per server — this lane exists to trip ONE server's
  // limit at a time, then stop. Never pooled, never concurrent.
  for (const server of serverList) {
    if (dryRun) {
      out.push({ server, captured: false, queries: 0 });
      continue;
    }
    let captured = false;
    let queries = 0;
    const bank = (raw: string): void => {
      const path = `${THROTTLED_DIR}${server}___throttled.txt`;
      if (raw && !existsSync(path)) writeFileSync(path, raw, 'utf8');
    };
    for (let i = 0; i < cap && !captured; i++) {
      queries++;
      try {
        // NO retries: the default would re-fire retryable (throttled/timeout) queries and
        // silently double the upstream burst past the owner-approved --max-per-server cap
        const result = await queryRaw(burstClient, server, `burst-${i}.example`, 0);
        const raw = result?.raw ?? '';
        if (raw && Object.keys(detectMeta(raw, FORMAT)).includes('throttled')) {
          bank(raw);
          captured = true;
        }
      } catch (error) {
        // the usual capture path: the parser recognized the throttle page and the client
        // THREW. The error carries the page — bank it; a capture without a fixture would
        // report success while leaving the corpus unchanged.
        if (error instanceof RateLimitError) {
          const query = `burst-${i}.example`;
          if (error.raw) bank(addRawMetadata(query, server, new Date().toISOString(), error.raw));
          captured = true;
        }
      }
      await new Promise(r => setTimeout(r, THROTTLE_BURST_PACE_MS));
    }
    out.push({ server, captured, queries });
    console.log(
      `  ${server}: ${captured ? '✓ captured' : '✗ no throttle page'} after ${queries} queries`
    );
  }
  return out;
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const onlyServer = getFlag('server');
  const dryRun = process.argv.includes('--dry-run');

  // lane selection: --reserved / --servfail pick specific lanes; neither given runs both
  // default (offline+polite) lanes. Throttled is NEVER a default — it needs its own flag.
  const wantReserved = process.argv.includes('--reserved');
  const wantServfail = process.argv.includes('--servfail');
  const bothDefault = !wantReserved && !wantServfail;
  const doReserved = wantReserved || bothDefault;
  const doServfail = wantServfail || bothDefault;
  const doThrottled = process.argv.includes('--gather-throttled');

  // validate the throttled lane's args UP FRONT: bailing out after the default lanes had
  // already run would exit before the report write and throw their results away
  const throttleServers = (getFlag('throttle-servers') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (doThrottled && !throttleServers.length) {
    console.error(
      `\n🔴 --gather-throttled needs --throttle-servers a,b,c (an owner-approved set). ` +
        `This lane deliberately trips rate limits — it never runs on an implicit target list.`
    );
    process.exit(1);
  }

  mkdirSync(HEALTH_DIR, { recursive: true });
  const report: Record<string, unknown> = { gatheredAt: new Date().toISOString() };

  if (doServfail) {
    const { promoted } = promoteServfail(dryRun);
    console.log(
      `\nservfail: promoted ${promoted.length} unclassified → fixtures/servfail/` +
        `${dryRun ? ' (dry-run, not moved)' : ''}`
    );
    for (const f of promoted.slice(0, 20)) console.log(`  ${f}`);
    report.servfail = { promoted };
  }

  if (doReserved) {
    const { confirmed, suspected, before, after } = await gatherReserved(limit, onlyServer, dryRun);
    console.log(
      `\nreserved: ${confirmed.length} confirmed (anchored reserved fired, banked live), ` +
        `${suspected.length} suspected (P3 worklist, NOT banked)`
    );
    console.log(`  reserved-covered servers: ${before} → ${after} (+${after - before})`);
    if (suspected.length) {
      console.log(`\n  suspected reserved — P3 pattern-mining worklist (first 15):`);
      for (const s of suspected.slice(0, 15))
        console.log(`    ${s.server}: ${s.snippet.slice(0, 100)}`);
    }
    report.reserved = { before, after, confirmed, suspected };
  }

  if (doThrottled) {
    const cap = Number(getFlag('max-per-server')) || THROTTLE_CAP_DEFAULT;
    console.log(`\nthrottled: bursting ${throttleServers.length} server(s), cap ${cap}/server …`);
    report.throttled = await gatherThrottled(throttleServers, cap, dryRun);
  }

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\nreport: registry-health/gather-meta.json`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
