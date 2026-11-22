#!/usr/bin/env tsx
// Probe every whois server we route to and classify liveness + parse quality
// (docs/registry-health.md M2). One probe per unique registry server from the merged
// TLD map, plus the RIRs, IANA, and SPECIAL_SERVERS hosts. Probes run through the
// library client (scripts/lib/client.ts), so each server's own query string, the
// per-server limits and the proxy apply.
//
// Probe query per server: a fixture-corpus domain when we have one (known-registered,
// 952 servers covered), else `nic.<tld>` for a TLD the server serves. Outcomes fold
// into registry-health/state.json (consecutive-failure tracking for the M3
// decision rules): throttled/notfound are ALIVE, only connection-level failures and
// suspect empties count toward phase-out evidence.
//
// Run: npm run whois:check-servers [--limit N] [--sample N] [--server host] [--no-save]
//   --sample N   probe a random N-of-all sample (the light CI sweep; vs --limit's first N)
//   --no-save    probe + report but don't persist state.json (report-only CI runs)
import { readdirSync } from 'node:fs';
import { WHOIS_REGIONAL_REGISTRIES } from '../../src/whois/constants';
import { IANA_WHOIS_SERVER, SPECIAL_SERVERS } from '../../src/whois/constants';
import { getTldServers } from './generate-tlds';
import {
  loadState,
  recordProbe,
  runPool,
  sampleN,
  saveState,
  type ProbeClassification,
} from '../registry-health/state';
import { probeWhoisServer } from './probe/whois-probe';
import { persistThrottling } from '../registry-health/throttling';
import { WHOIS_FIXTURES_DIR } from '../lib/paths';

const FIXTURES_DIR = `${WHOIS_FIXTURES_DIR}found/`;

const CONCURRENCY = 8;
const PACE_MS = 150;

// fixed probe queries for the non-registry servers (IP/ASN space + IANA itself)
const FIXED_QUERIES: Record<string, string> = {
  [IANA_WHOIS_SERVER]: 'com',
  [WHOIS_REGIONAL_REGISTRIES.ARIN]: '8.8.8.8',
  [WHOIS_REGIONAL_REGISTRIES.RIPE]: '193.0.0.0',
  [WHOIS_REGIONAL_REGISTRIES.APNIC]: '1.1.1.1',
  [WHOIS_REGIONAL_REGISTRIES.LACNIC]: '200.3.14.10',
  [WHOIS_REGIONAL_REGISTRIES.AFRINIC]: '196.216.2.1',
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// server → a known-registered domain from the fixture corpus (freshest available signal
// we have for "this domain exists on this server")
function corpusQueries(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (!file.endsWith('.txt')) continue;
    const [server, query] = file.replace(/\.txt$/, '').split('___');
    if (server && query && !map.has(server)) {
      map.set(server, query);
    }
  }
  return map;
}

// enumerate every server we route to, with the query to probe it with
function buildProbeList(): Array<{ server: string; query: string; tld: string | undefined }> {
  const corpus = corpusQueries();
  const tldServers = getTldServers();

  // server → shortest TLD it serves (for the nic.<tld> fallback probe; dotted
  // pseudo-TLDs like ac.za count — nic.ac.za is a fine probe for whois.ac.za)
  const serverTld = new Map<string, string>();
  for (const [tld, server] of Object.entries(tldServers)) {
    if (!server) continue;
    const current = serverTld.get(server);
    if (!current || tld.length < current.length) {
      serverTld.set(server, tld);
    }
  }

  const servers = new Set<string>([
    ...Object.values(tldServers).filter((s): s is string => Boolean(s)),
    ...Object.values(WHOIS_REGIONAL_REGISTRIES),
    ...Object.values(SPECIAL_SERVERS)
      .map(s => s.host)
      .filter(Boolean),
  ]);

  return [...servers].sort().map(server => ({
    server,
    tld: serverTld.get(server),
    query: FIXED_QUERIES[server] ?? corpus.get(server) ?? `nic.${serverTld.get(server) ?? 'com'}`,
  }));
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const sample = Number(getFlag('sample')) || undefined;
  const only = getFlag('server');
  const noSave = process.argv.includes('--no-save');

  let probes = buildProbeList();
  if (only) probes = probes.filter(p => p.server === only);
  if (sample) probes = sampleN(probes, sample);
  if (limit) probes = probes.slice(0, limit);
  console.log(
    `probing ${probes.length} whois servers${sample ? ` (random sample of ${sample})` : ''}...`
  );

  const state = loadState();

  // first pass: probe everything, collecting the raw classification per server
  const outcomes = new Map<
    string,
    Awaited<ReturnType<typeof probeWhoisServer>> & { query: string }
  >();
  let done = 0;
  await runPool(probes, CONCURRENCY, PACE_MS, async ({ server, query }) => {
    outcomes.set(server, { ...(await probeWhoisServer(server, query)), query });
    if (++done % 100 === 0) console.log(`  ${done}/${probes.length}`);
  });

  // retry round: a single proxy timeout / rotating-exit HostUnreachable shouldn't
  // inflate a healthy server's failure counter. Genuine deaths fail the retry too
  // (verified: dropped gTLDs + gone hosts stay dead), so only transients recover.
  const retryable = [...outcomes.entries()].filter(
    ([, o]) => o.classification === 'dead-candidate' || o.classification === 'suspect'
  );
  if (retryable.length) {
    console.log(`retrying ${retryable.length} dead/suspect servers...`);
    await runPool(retryable, CONCURRENCY, PACE_MS, async ([server, { query }]) => {
      outcomes.set(server, { ...(await probeWhoisServer(server, query)), query });
    });
  }

  // fold final outcomes into state (sorted for a stable committed diff)
  const counts: Partial<Record<ProbeClassification, number>> = {};
  const flagged: string[] = [];
  for (const { server } of probes) {
    const outcome = outcomes.get(server)!;
    const record = recordProbe(state.whois, server, { ...outcome, probeQuery: outcome.query });
    counts[outcome.classification] = (counts[outcome.classification] ?? 0) + 1;
    if (outcome.classification !== 'healthy') {
      flagged.push(
        `${server} [${outcome.classification}${
          record.consecutiveFailures ? ` ×${record.consecutiveFailures}` : ''
        }] ${outcome.query}${outcome.detail ? ` — ${outcome.detail}` : ''}`
      );
    }
  }

  if (noSave) {
    console.log('\n--no-save: state.json NOT written (report-only run)');
  } else {
    saveState(state);
  }
  // the throttling seen, against the limits the library applied (throttling.json)
  persistThrottling('whois', outcomes, !noSave);

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`\nprobed ${probes.length} servers in ${elapsed}s:`);
  for (const [classification, count] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${classification}: ${count}`);
  }
  if (flagged.length) {
    console.log(`\nnon-healthy servers:`);
    flagged.sort().forEach(line => console.log(`  ${line}`));
  }
  // Report-only (CI) mode: emit one machine-parseable row per PROBED server so the
  // workflow can list exactly which sample it picked + each status (SAMPLE_ROW is
  // tab-delimited: marker, lane, tld, server, classification). Local saving runs skip it.
  if (noSave) {
    for (const { server, tld, query } of probes) {
      const outcome = outcomes.get(server)!;
      console.log(`SAMPLE_ROW\twhois\t${tld ?? query}\t${server}\t${outcome.classification}`);
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
