#!/usr/bin/env tsx
// Probe every unique RDAP base URL in the committed IANA bootstrap files and classify
// liveness (docs/registry-health.md M2). Uses its own fetch wrapper rather than
// rdapFetch: probes must follow 3xx manually (rdapFetch doesn't), must not retry 404s
// (rdapServerTool.shouldRetry retries everything), and an RDAP 404 error body IS a
// liveness positive — a conformant "no such object" proves the server works.
//
// Each base URL gets one sample query built from the bootstrap file it appears in
// (domain/nic.<tld>, autnum/<range-start>, ip/<network>, entity probes via /help).
// Outcomes fold into registry-health/state.json alongside the whois lane.
//
// Run: npm run rdap:check-servers [--limit N] [--sample N] [--base url] [--no-save]
//   --sample N   probe a random N-of-all sample (the light CI sweep; vs --limit's first N)
//   --no-save    probe + report but don't persist state.json (report-only CI runs)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeRdapServer } from '../../src/rdap/utils';
import { getRdapRoutes } from '../whois/generate-tlds';
import {
  loadState,
  recordProbe,
  runPool,
  sampleN,
  saveState,
  type ProbeClassification,
} from '../registry-health/state';
import { probeRdapBase } from './probe/rdap-probe';
import { persistThrottling } from '../registry-health/throttling';
import { RDAP_DATA_DIR } from '../lib/paths';

const CONCURRENCY = 6;
const PACE_MS = 150;

type BootstrapFile = { publication: string; services: string[][][] };

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// enumerate unique base URLs across all bootstrap files, each with a sample query
// path appropriate to the registry type it serves. The base is keyed by
// normalizeRdapServer — the SAME canonical form (lowercase, http→https, one trailing
// slash) that getRdapServerFromCache and the RDAP tool route by — so the committed
// state records match the server URLs prod actually uses (the M3 lookup key).
function buildProbeList(): Array<{ base: string; path: string }> {
  const bases = new Map<string, string>();

  // key is the canonical base WITH its single trailing slash (prod's form); probe
  // URLs are joined as `${base}${path}` so they never double-slash
  const add = (url: string, path: string) => {
    const base = normalizeRdapServer(url);
    if (base && base !== '/' && !bases.has(base)) bases.set(base, path);
  };

  const load = (name: string): BootstrapFile =>
    JSON.parse(readFileSync(`${RDAP_DATA_DIR}${name}.json`, 'utf8')) as BootstrapFile;

  for (const [keys, urls] of load('dns').services) {
    for (const url of urls) add(url, `domain/nic.${keys[0].toLowerCase()}`);
  }
  // ALSO probe every base the merged layers route domains to — the discovered
  // and overrides layers (§10.4) add bases absent from the bootstrap JSON above. Without
  // a probe record, a discovered/override-only endpoint stays "RDAP listed but unhealthy"
  // in decide() forever and can never enable a phase-out, even when the endpoint works.
  for (const [pattern, base] of Object.entries(getRdapRoutes())) {
    add(base, `domain/nic.${pattern.toLowerCase()}`);
  }
  for (const [keys, urls] of load('asn').services) {
    for (const url of urls) add(url, `autnum/${keys[0].split('-')[0]}`);
  }
  for (const [keys, urls] of load('ipv4').services) {
    for (const url of urls) add(url, `ip/${keys[0].split('/')[0]}`);
  }
  for (const [keys, urls] of load('ipv6').services) {
    for (const url of urls) add(url, `ip/${keys[0].split('/')[0]}`);
  }
  // object-tags services are [maintainers, tags, urls]; there's no cheap sample
  // entity handle, so probe the RFC 7480 /help endpoint instead
  for (const entry of load('object-tags').services) {
    for (const url of entry[2]) add(url, 'help');
  }

  return [...bases.entries()]
    .map(([base, path]) => ({ base, path }))
    .sort((a, b) => a.base.localeCompare(b.base));
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const sample = Number(getFlag('sample')) || undefined;
  const only = getFlag('base');
  const noSave = process.argv.includes('--no-save');

  let probes = buildProbeList();
  if (only) probes = probes.filter(p => p.base.includes(only));
  if (sample) probes = sampleN(probes, sample);
  if (limit) probes = probes.slice(0, limit);
  console.log(
    `probing ${probes.length} RDAP base URLs${sample ? ` (random sample of ${sample})` : ''}...`
  );

  const state = loadState();

  // first pass
  const outcomes = new Map<
    string,
    { classification: ProbeClassification; detail?: string; path: string }
  >();
  let done = 0;
  await runPool(probes, CONCURRENCY, PACE_MS, async ({ base, path }) => {
    outcomes.set(base, { ...(await probeRdapBase(base, path)), path });
    if (++done % 50 === 0) console.log(`  ${done}/${probes.length}`);
  });

  // retry round: one transient network blip / rotating-exit failure shouldn't inflate
  // a live server's failure counter. Genuinely down bases fail the retry too.
  const retryable = [...outcomes.entries()].filter(
    ([, o]) => o.classification === 'dead-candidate' || o.classification === 'suspect'
  );
  if (retryable.length) {
    console.log(`retrying ${retryable.length} dead/suspect bases...`);
    await runPool(retryable, CONCURRENCY, PACE_MS, async ([base, { path }]) => {
      outcomes.set(base, { ...(await probeRdapBase(base, path)), path });
    });
  }

  // fold final outcomes into state
  const counts: Partial<Record<ProbeClassification, number>> = {};
  const flagged: string[] = [];
  for (const { base } of probes) {
    const outcome = outcomes.get(base)!;
    const record = recordProbe(state.rdap, base, { ...outcome, probeQuery: outcome.path });
    counts[outcome.classification] = (counts[outcome.classification] ?? 0) + 1;
    if (outcome.classification !== 'healthy') {
      flagged.push(
        `${base} [${outcome.classification}${
          record.consecutiveFailures ? ` ×${record.consecutiveFailures}` : ''
        }] ${outcome.path}${outcome.detail ? ` — ${outcome.detail}` : ''}`
      );
    }
  }

  if (noSave) {
    console.log('\n--no-save: state.json NOT written (report-only run)');
  } else {
    saveState(state);
  }
  // the throttling seen, against the limits the library applied (throttling.json)
  persistThrottling('rdap', outcomes, !noSave);

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`\nprobed ${probes.length} RDAP bases in ${elapsed}s:`);
  for (const [classification, count] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${classification}: ${count}`);
  }
  if (flagged.length) {
    console.log(`\nnon-healthy bases:`);
    flagged.sort().forEach(line => console.log(`  ${line}`));
  }
  // Report-only (CI) mode: emit one machine-parseable row per PROBED base so the workflow
  // can list exactly which sample it picked + each status (SAMPLE_ROW is tab-delimited:
  // marker, lane, tld, base, classification). The tld is the `domain/nic.<tld>` sample
  // path when this base serves domains, else the raw probe path (autnum/ip/help).
  if (noSave) {
    for (const { base, path } of probes) {
      const outcome = outcomes.get(base)!;
      const tld = path.startsWith('domain/nic.') ? path.slice('domain/nic.'.length) : path;
      console.log(`SAMPLE_ROW\trdap\t${tld}\t${base}\t${outcome.classification}`);
    }
  }

  console.log(
    noSave ? `\n(state unchanged — --no-save)` : `\nstate updated: registry-health/state.json`
  );
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
