#!/usr/bin/env tsx
// `npm run whois:oracle-compare` — cross-parse WHOIS text with community parser oracles and
// diff the extracted fields against our block engine (docs/registry-health.md,
// Leg 2). Oracles are signal, not ground truth; the harness weights them accordingly:
// whoiser (in-process, shallow) is a completeness voice, likexian (Go) and weppos (Ruby)
// run as in-repo CLI wrappers when built (scripts/oracles/ — auto-detected, never
// required), and our own RDAP result joins as the near-ground-truth voice in live mode.
//
// Modes:
//   corpus (default)  offline + deterministic: every fixtures/found/*.txt raw response is
//                     parsed by us and by every available oracle; fields are compared
//                     after normalization (scripts/oracles/schema.ts)
//   --live N          N random registered domains (tranco names per TLD) queried once
//                     through the library client (proxy); the SAME raw
//                     text goes to us + the oracles, and our RDAP tool votes as a third
//                     voice where the TLD has a route. Catches format drift the frozen
//                     corpus can't.
//
// Divergence buckets (mirrors check-parsers.ts causes):
//   we-missing      an oracle extracted a value, we returned null — the actionable class,
//                   strongest when 2+ oracles agree on the value
//   value-mismatch  both present, different after normalization, and NO oracle agrees
//                   with us — human look
//   we-extra        we extracted, no oracle did — usually our parser being better;
//                   report-only
//
// Carry-forward (O4): divergences aggregate by `server|field|bucket`; keys already in the
// committed registry-health/oracle-known.json are suppressed as reviewed, only NEW
// keys surface. --write advances the known file (the weekly PR diff is the review gate).
// --strict exits non-zero on a NEW we-missing key on a top-100 TLD or top-100 registrar
// server where >=2 oracles agree on the extracted value.
//
// Run: npm run whois:oracle-compare
//        [--live N] [--limit N] [--server host] [--write] [--strict] [--mine-aliases]
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { GENERIC_KV_ALIASES } from '../../src/whois/formats/generic-kv';
import { MINED_ALIASES, SCOPE_ALIASES } from '../../src/whois/aliases';
import { parseBlocks } from '../../src/whois/mapping';
import { stripRawMetadata } from './lib/raw';
import { TOP_100_REGISTRARS, TOP_100_TLDS } from './lib/top-100';
import {
  ORACLE_FIELDS,
  normalizeValue,
  normalizedMatch,
  type OracleFieldName,
  type OracleResult,
} from './oracles/schema';
import { mineWhoiserLabels, parseWithWhoiser } from './oracles/whoiser-oracle';
import { HEALTH_DIR, TRANCO_NAMES_FILE, WHOIS_FIXTURES_DIR } from '../lib/paths';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;
const ORACLES_DIR = fileURLToPath(new URL('./oracles/', import.meta.url));
const REPORT_DIR = HEALTH_DIR;
const KNOWN_FILE = `${REPORT_DIR}oracle-known.json`;

// a date as the oracles' schema compares it: UTC, whole seconds
const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

// our parser's fields under the oracle schema's snake_case names. The status is the text
// the server wrote, not the EPP codes read from it: the oracles report raw status text too,
// and without this every status in the corpus reads as we-missing. DNSSEC likewise
function oracleView(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ORACLE_FIELDS) {
    const name = field.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase());
    const value =
      field === 'status'
        ? (data.eppStatusRaw ?? data.eppStatus)
        : field === 'dnssec'
          ? data.dnssecRaw
          : data[name];
    out[field] = value instanceof Date ? isoSeconds(value) : (value ?? null);
  }
  return out;
}

const TOP_REGISTRAR_SERVERS = new Set(
  Object.values(TOP_100_REGISTRARS).map(server => server.toLowerCase())
);

type Item = { key: string; server: string; query: string; raw: string };
type Bucket = 'we-missing' | 'value-mismatch' | 'we-extra';
type Vote = { oracle: string; value: string | string[] };
type KeyEntry = {
  count: number;
  maxAgree: number;
  oracles: string[];
  top100: boolean;
  // some single occurrence had 2+ oracles agreeing on a top-100 response — the red-gate
  // conjunction, evaluated per response (top100 && maxAgree>=2 at group level is not
  // enough: they can come from different responses on a multi-TLD server)
  top100Strong: boolean;
  samples: Array<{
    query: string;
    ours: string | string[] | null;
    votes: Record<string, string | string[] | null>;
  }>;
};
type KnownEntry = { firstSeen: string; lastSeen: string; count: number };
type OracleStats = { parsed: number; errors: number; notFound: number };

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

const isTop100 = (server: string, query: string): boolean =>
  TOP_100_TLDS.includes(query.split('.').pop() ?? '') ||
  TOP_REGISTRAR_SERVERS.has(server.toLowerCase());

// ── oracle adapters ──────────────────────────────────────────────────────────
// External wrappers speak the batch protocol from scripts/oracles/schema.md: a directory
// of `<server>___<query>.txt` files (provenance headers pre-stripped), NDJSON results on
// stdout keyed by filename. They are auto-detected — a dev without the Go/Ruby toolchains
// just runs whoiser-only.

const LIKEXIAN_BIN =
  process.env.ORACLE_LIKEXIAN_BIN ?? join(ORACLES_DIR, 'likexian/likexian-oracle');
const WEPPOS_DIR = join(ORACLES_DIR, 'weppos');

type ExternalSpec = { name: string; command: string; args: string[]; cwd?: string };

// gems install under the oracle dir (vendor/bundle) so local runs and CI resolve the
// same way without a committed .bundle/config
const BUNDLE_ENV = { ...process.env, BUNDLE_PATH: process.env.BUNDLE_PATH ?? 'vendor/bundle' };

function externalOracles(): ExternalSpec[] {
  const specs: ExternalSpec[] = [];
  if (existsSync(LIKEXIAN_BIN)) {
    specs.push({ name: 'likexian', command: LIKEXIAN_BIN, args: [] });
  }
  const bundleCheck = spawnSync('bundle', ['check'], {
    cwd: WEPPOS_DIR,
    env: BUNDLE_ENV,
    stdio: 'ignore',
  });
  if (bundleCheck.status === 0) {
    specs.push({
      name: 'weppos',
      command: 'bundle',
      args: ['exec', 'ruby', 'weppos-oracle.rb'],
      cwd: WEPPOS_DIR,
    });
  }
  return specs;
}

type OracleOutcome = OracleResult | { error: string };

function runExternalBatch(spec: ExternalSpec, dir: string): Map<string, OracleOutcome> {
  const results = new Map<string, OracleOutcome>();
  const stdout = execFileSync(spec.command, [...spec.args, '--dir', dir], {
    cwd: spec.cwd,
    env: BUNDLE_ENV,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as { file: string } & (
      { error: string } | { notFound: boolean; reserved: boolean; fields: OracleResult['fields'] }
    );
    const key = parsed.file.replace(/\.txt$/, '');
    results.set(
      key,
      'error' in parsed
        ? { error: parsed.error }
        : { notFound: parsed.notFound, reserved: parsed.reserved, fields: parsed.fields ?? {} }
    );
  }
  return results;
}

async function runOracles(
  items: Item[]
): Promise<{ names: string[]; byOracle: Map<string, Map<string, OracleOutcome>> }> {
  const byOracle = new Map<string, Map<string, OracleOutcome>>();

  // whoiser: always available, in-process
  const whoiserResults = new Map<string, OracleOutcome>();
  for (const item of items) {
    try {
      whoiserResults.set(item.key, await parseWithWhoiser(item.query, item.raw));
    } catch (error) {
      whoiserResults.set(item.key, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  byOracle.set('whoiser', whoiserResults);

  // external wrappers: one batch invocation over a temp dir each
  const externals = externalOracles();
  if (externals.length) {
    const dir = mkdtempSync(join(tmpdir(), 'whois-oracle-'));
    try {
      for (const item of items) {
        writeFileSync(join(dir, `${item.key}.txt`), item.raw, 'utf8');
      }
      for (const spec of externals) {
        try {
          byOracle.set(spec.name, runExternalBatch(spec, dir));
        } catch (error) {
          console.error(
            `oracle ${spec.name} batch failed: ${error instanceof Error ? error.message : error}`
          );
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { names: [...byOracle.keys()], byOracle };
}

// ── the compare core ─────────────────────────────────────────────────────────

function compareItems(
  items: Item[],
  byOracle: Map<string, Map<string, OracleOutcome>>,
  extraVotes?: Map<string, OracleResult> // live mode: the RDAP voice, keyed by item key
): {
  byKey: Record<string, KeyEntry>;
  bucketTotals: Record<Bucket, number>;
  oracleStats: Record<string, OracleStats>;
} {
  const byKey: Record<string, KeyEntry> = {};
  const bucketTotals: Record<Bucket, number> = {
    'we-missing': 0,
    'value-mismatch': 0,
    'we-extra': 0,
  };
  const oracleStats: Record<string, OracleStats> = {};
  for (const name of byOracle.keys()) oracleStats[name] = { parsed: 0, errors: 0, notFound: 0 };
  if (extraVotes?.size) oracleStats.rdap = { parsed: extraVotes.size, errors: 0, notFound: 0 };

  const record = (
    bucket: Bucket,
    item: Item,
    field: OracleFieldName,
    ours: string | string[] | null,
    votes: Vote[],
    agree: number
  ): void => {
    bucketTotals[bucket]++;
    const key = `${item.server}|${field}|${bucket}`;
    const entry = (byKey[key] ??= {
      count: 0,
      maxAgree: 0,
      oracles: [],
      top100: false,
      top100Strong: false,
      samples: [],
    });
    entry.count++;
    entry.maxAgree = Math.max(entry.maxAgree, agree);
    entry.top100 ||= isTop100(item.server, item.query);
    // the red gate needs BOTH conditions on the SAME response: a server serving many
    // TLDs must not go red from a 2-agree occurrence on one (non-top-100) query plus an
    // unrelated 1-agree occurrence on a top-100 query
    entry.top100Strong ||= agree >= 2 && isTop100(item.server, item.query);
    for (const vote of votes) {
      if (!entry.oracles.includes(vote.oracle)) entry.oracles.push(vote.oracle);
    }
    if (entry.samples.length < 3) {
      entry.samples.push({
        query: item.query,
        ours,
        votes: Object.fromEntries(votes.map(v => [v.oracle, v.value])),
      });
    }
  };

  for (const item of items) {
    // our engine's view of the same raw text
    let ours: Record<string, unknown>;
    try {
      const parsed = parseBlocks(item.raw, item.server, DOMAIN_QUERY_TYPE);
      // a response our engine classifies as notfound/throttled/reserved/an error isn't
      // registration data — nothing to cross-check (live mode can hit these; the corpus
      // shouldn't)
      if (parsed.status !== 'found') continue;
      // the oracle schema keeps its own snake_case vocabulary
      ours = oracleView((parsed.data ?? {}) as unknown as Record<string, unknown>);
    } catch {
      continue; // our parse errors are check-parsers' beat, not this report's
    }

    // this fixture's usable oracle results
    const usable: Array<{ oracle: string; result: OracleResult }> = [];
    for (const [name, results] of byOracle) {
      const outcome = results.get(item.key);
      if (!outcome) continue;
      if ('error' in outcome) {
        oracleStats[name].errors++;
      } else if (outcome.notFound || outcome.reserved) {
        // an oracle calling a found-lane response unregistered is an oracle quirk;
        // counted, and its (empty) fields never vote
        oracleStats[name].notFound++;
      } else {
        oracleStats[name].parsed++;
        usable.push({ oracle: name, result: outcome });
      }
    }
    // the RDAP voice only joins when at least one TEXT parser (ours or an oracle) read
    // registration data out of the response — otherwise the whois response wasn't data
    // (an unclassified throttle/legal page) and rdap-vs-nothing would flood every field
    const anyTextData =
      ORACLE_FIELDS.some(field => normalizeValue(field, ours[field]) != null) ||
      usable.some(({ result }) =>
        ORACLE_FIELDS.some(field => normalizeValue(field, result.fields[field]) != null)
      );
    const rdapVote = extraVotes?.get(item.key);
    if (rdapVote && anyTextData) usable.push({ oracle: 'rdap', result: rdapVote });
    if (!usable.length) continue;

    for (const field of ORACLE_FIELDS) {
      const oursNorm = normalizeValue(field, ours[field]);
      const votes: Vote[] = [];
      for (const { oracle, result } of usable) {
        const value = normalizeValue(field, result.fields[field]);
        if (value != null) votes.push({ oracle, value });
      }
      // max cluster of oracles agreeing on one value — for we-missing, "how many said
      // the same thing we said nothing about"; for value-mismatch, "how many agree with
      // each other AGAINST us" (2+ incl. rdap is O3's highest-confidence signal)
      const agree = votes.length
        ? Math.max(
            ...votes.map(a => votes.filter(b => normalizedMatch(field, a.value, b.value)).length)
          )
        : 0;
      if (oursNorm == null && votes.length) {
        record('we-missing', item, field, oursNorm, votes, agree);
      } else if (oursNorm != null && votes.length) {
        if (!votes.some(v => normalizedMatch(field, oursNorm, v.value))) {
          record('value-mismatch', item, field, oursNorm, votes, agree);
        }
      } else if (oursNorm != null && usable.length && !votes.length) {
        record('we-extra', item, field, oursNorm, votes, 0);
      }
    }
  }

  return { byKey, bucketTotals, oracleStats };
}

// ── corpus + live item sources ───────────────────────────────────────────────

function corpusItems(): Item[] {
  const only = getFlag('server');
  const limit = Number(getFlag('limit')) || undefined;
  const items = readdirSync(FOUND_DIR)
    .filter(f => f.endsWith('.txt') && f.includes('___'))
    .map(f => {
      const key = f.replace(/\.txt$/, '');
      const [server, query] = key.split('___');
      return { key, server, query, raw: stripRawMetadata(readFileSync(FOUND_DIR + f, 'utf8')) };
    })
    .filter(item => !only || item.server === only)
    .sort((a, b) => a.key.localeCompare(b.key));
  return limit ? items.slice(0, limit) : items;
}

async function liveItems(
  count: number
): Promise<{ items: Item[]; rdap: Map<string, OracleResult> }> {
  // lazy imports: the live path pulls in the client (network, proxy); corpus mode must stay
  // runnable without it
  const { toolingClient } = await import('../lib/client');
  const { sampleN } = await import('../registry-health/state');
  const client = toolingClient();

  const names = loadJson<Record<string, string[]>>(TRANCO_NAMES_FILE, {});
  const pool = Object.values(names).flat();
  const domains = sampleN(pool, count);
  console.log(`live sample: ${domains.length} domains (of ${pool.length} candidates)`);

  const items: Item[] = [];
  const rdap = new Map<string, OracleResult>();
  for (const domain of domains) {
    try {
      const [hop] = await client.whois(domain, { followReferrals: 0, timeout: 10000 });
      if (!hop?.raw || hop.status !== 'found' || !hop.server) continue;
      const key = `${hop.server}___${domain}`;
      items.push({ key, server: hop.server, query: domain, raw: hop.raw });

      // the RDAP voice (O3): our own RDAP result on the overlapping fields — the closest
      // thing to ground truth this system has. Quietly absent for RDAP-less TLDs.
      try {
        const { record, source } = await client.lookup(domain);
        if (source?.protocol === 'rdap' && !record.available && !record.reserved) {
          const date = (value: Date | null) => (value ? isoSeconds(value) : null);
          rdap.set(key, {
            notFound: false,
            reserved: false,
            fields: {
              domain_name: record.domainName,
              creation_date: date(record.creationDate),
              updated_date: date(record.updatedDate),
              expiration_date: date(record.expirationDate),
              status: record.eppStatus ?? [],
              nameservers: record.nameservers ?? [],
              registrar_id:
                record.registrar?.ianaId != null ? String(record.registrar.ianaId) : null,
              registrar_name: record.registrar?.name ?? null,
              registrar_url: record.registrar?.url ?? null,
              registrant_name: record.registrant?.name ?? null,
              registrant_org: record.registrant?.org ?? null,
              registrant_email: record.registrant?.email ?? null,
            },
          });
        }
      } catch {
        // no RDAP route / RDAP error — the whois-side compare still counts
      }
    } catch (error) {
      console.log(`  skip ${domain}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { items, rdap };
}

// ── alias mining (one-off bonus in O2) ───────────────────────────────────────

function mineAliases(): Array<{ from: string; to: string }> {
  // every spelling our engine already recognizes, lowercased (flat tables + the scoped
  // suffix table — a scoped spelling can match any role prefix)
  const known = new Set<string>();
  for (const table of [GENERIC_KV_ALIASES, MINED_ALIASES, SCOPE_ALIASES]) {
    for (const spellings of Object.values(table)) {
      for (const spelling of spellings) known.add(spelling.toLowerCase());
    }
  }
  const unknown = mineWhoiserLabels().filter(({ from }) => {
    const label = from.toLowerCase().replace(/\.+$/, '').trim();
    return !known.has(label) && !known.has(from.toLowerCase());
  });
  return unknown;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const started = Date.now();
  const live = getFlag('live');
  const write = process.argv.includes('--write');
  const strict = process.argv.includes('--strict');
  const mode = live ? 'live' : 'corpus';

  if (process.argv.includes('--mine-aliases')) {
    const unknown = mineAliases();
    console.log(`whoiser knows ${unknown.length} label spelling(s) our alias tables don't:`);
    for (const { from, to } of unknown) console.log(`  ${JSON.stringify(from)} → ${to}`);
    process.exit(0);
  }

  let items: Item[];
  let rdapVotes: Map<string, OracleResult> | undefined;
  if (live) {
    const sample = await liveItems(Number(live) || 25);
    items = sample.items;
    rdapVotes = sample.rdap;
  } else {
    items = corpusItems();
  }
  console.log(`${mode} mode: ${items.length} response(s) to compare`);

  const { names, byOracle } = await runOracles(items);
  console.log(`oracles: ${[...names, ...(rdapVotes?.size ? ['rdap'] : [])].join(', ')}`);

  const { byKey, bucketTotals, oracleStats } = compareItems(items, byOracle, rdapVotes);

  // carry-forward vs the committed known file (corpus mode only — the live sample is a
  // different random slice each run, so knowns would never converge)
  const known = mode === 'corpus' ? loadJson<Record<string, KnownEntry>>(KNOWN_FILE, {}) : {};
  const newKeys =
    mode === 'corpus'
      ? Object.keys(byKey)
          .filter(key => !(key in known))
          .sort()
      : [];
  const redKeys = newKeys.filter(key => key.endsWith('|we-missing') && byKey[key].top100Strong);

  if (mode === 'corpus' && write) {
    const now = new Date().toISOString();
    const next: Record<string, KnownEntry> = {};
    for (const key of Object.keys(byKey).sort()) {
      next[key] = {
        firstSeen: known[key]?.firstSeen ?? now,
        lastSeen: now,
        count: byKey[key].count,
      };
    }
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(KNOWN_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  // ── report ─────────────────────────────────────────────────────────────────
  console.log(`\n# Oracle cross-check (${mode})\n`);
  for (const [name, stats] of Object.entries(oracleStats)) {
    console.log(
      `- ${name}: ${stats.parsed} parsed, ${stats.errors} errors, ${stats.notFound} notfound-on-found`
    );
  }
  console.log(
    `\nbuckets: ${bucketTotals['we-missing']} we-missing, ` +
      `${bucketTotals['value-mismatch']} value-mismatch, ${bucketTotals['we-extra']} we-extra ` +
      `across ${Object.keys(byKey).length} server|field group(s)`
  );
  const worst = Object.entries(byKey)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15);
  if (worst.length) {
    console.log(`\nworst groups:`);
    for (const [key, entry] of worst) {
      console.log(`  ${key}: ${entry.count} (agree ${entry.maxAgree}, ${entry.oracles.join('+')})`);
    }
  }
  if (mode === 'corpus') {
    console.log(`\nnew since last review: ${newKeys.length}`);
    for (const key of newKeys.slice(0, 20)) console.log(`  ${key} (${byKey[key].count})`);
    if (newKeys.length > 20) console.log(`  …and ${newKeys.length - 20} more`);
  }

  const reportFile = `${REPORT_DIR}oracle-${mode === 'live' ? 'live' : 'compare'}.json`;
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    reportFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        oracles: Object.keys(oracleStats),
        compared: items.length,
        oracleStats,
        buckets: bucketTotals,
        groups: Object.keys(byKey).length,
        ...(mode === 'corpus' && { newKeys, redKeys }),
        byKey: Object.fromEntries(Object.entries(byKey).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log(`\nwrote ${reportFile}`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);

  if (strict && redKeys.length) {
    console.error(
      `\n🔴 --strict: ${redKeys.length} NEW we-missing group(s) on top-100 targets with 2+ oracles agreeing:`
    );
    for (const key of redKeys) console.error(`  ${key}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
