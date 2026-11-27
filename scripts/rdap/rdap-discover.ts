#!/usr/bin/env tsx
// `npm run rdap:discover` (docs/registry-health.md §10.4) — look for working RDAP endpoints
// for TLDs that lack one, beyond the IANA bootstrap. Source: rdap.org (its curated router
// knows endpoints IANA hasn't bootstrapped — real cases like .de/.ch exist).
//
// Input is the PROBLEM SET, not all TLDs: whois-only TLDs with no RDAP route + RDAP routes
// that last probed unhealthy. Each candidate rdap.org returns is probe-VERIFIED with the
// same M2 harness the sweep uses (probeRdapBase — a conformant response, incl. a 404
// no-such-object, proves liveness). Only healthy endpoints are written, and even then only
// as a reviewable diff: the discovered layer data/rdap/dns-discovered.json (which
// DnsServerCache merges over the bootstrap, §10.4) + a discovery-rdap.json report. NEVER
// auto-adopted — a human merges the diff, and prod picks it up on the next deploy.
//
// Run: npm run rdap:discover [--limit N] [--tld a,b,c]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeProblemSet } from '../registry-health/problem-set';
import { rdapOrgSource } from './rdap-org';
import { summarizeBySource, type DiscoverySource } from '../registry-health/discovery';
import { probeRdapBase } from './probe/rdap-probe';
import { runPool } from '../registry-health/state';
import { HEALTH_DIR, RDAP_DATA_DIR } from '../lib/paths';
import { writeTlds } from '../whois/generate-tlds';

const DISCOVERED_FILE = `${RDAP_DATA_DIR}dns-discovered.json`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}discovery-rdap.json`;

const SOURCES: DiscoverySource[] = [rdapOrgSource];
const CONCURRENCY = 3;
const PACE_MS = 400;

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

type Attempt = {
  tld: string;
  source: string;
  base: string;
  classification: string;
  detail?: string;
};

async function main(): Promise<void> {
  const started = Date.now();
  const problem = computeProblemSet();

  // input = TLDs that need an RDAP route (no route at all, or a route that probed unhealthy)
  const only = getFlag('tld');
  let tlds = only
    ? only.split(',').map(t => t.trim().toLowerCase())
    : [...new Set([...problem.whoisOnlyNoRdap, ...problem.rdapUnhealthy])].sort();
  const limit = Number(getFlag('limit')) || undefined;
  if (limit) tlds = tlds.slice(0, limit);

  console.log(
    `rdap:discover — ${tlds.length} problem TLDs ` +
      `(${problem.whoisOnlyNoRdap.length} whois-only-no-RDAP, ${problem.rdapUnhealthy.length} RDAP-unhealthy)` +
      `\nsources: ${SOURCES.map(s => s.name).join(', ')}`
  );

  const attempts: Attempt[] = [];
  const discovered: Record<string, string> = {};
  const discoveredSource: Record<string, string> = {};
  let done = 0;

  await runPool(tlds, CONCURRENCY, PACE_MS, async tld => {
    for (const source of SOURCES) {
      let candidate: { servers: string[] };
      try {
        candidate = await source.lookup(tld);
      } catch (error) {
        attempts.push({
          tld,
          source: source.name,
          base: '',
          classification: 'error',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const base of candidate.servers) {
        const outcome = await probeRdapBase(base, `domain/nic.${tld}`);
        attempts.push({
          tld,
          source: source.name,
          base,
          classification: outcome.classification,
          detail: outcome.detail,
        });
        // only a probe-verified conformant endpoint is worth proposing; first one wins
        if (outcome.classification === 'healthy' && !discovered[tld]) {
          discovered[tld] = base;
          discoveredSource[tld] = source.name;
          console.log(`  ✓ ${tld} → ${base} (${source.name})`);
        }
      }
    }
    if (++done % 25 === 0) console.log(`  …${done}/${tlds.length} probed`);
  });

  // merge verified endpoints into the committed discovered layer (job only writes this
  // layer; owner-managed dns-overrides.json is never touched here). Keep prior entries.
  const existing: Record<string, string> = existsSync(DISCOVERED_FILE)
    ? (JSON.parse(readFileSync(DISCOVERED_FILE, 'utf8')) as Record<string, string>)
    : {};
  const merged = { ...existing, ...discovered };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DISCOVERED_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  writeTlds();

  // per-source productivity — so a source that never yields anything (i.e. it only
  // echoes IANA/another source) shows up and can be dropped (§10.4). Sum across attempts.
  const bySource = summarizeBySource(
    SOURCES.map(s => s.name),
    attempts.map(a => ({
      source: a.source,
      candidate: Boolean(a.base),
      alive: a.classification === 'healthy',
    })),
    discoveredSource
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map(s => s.name),
    input: {
      whoisOnlyNoRdap: problem.whoisOnlyNoRdap.length,
      rdapUnhealthy: problem.rdapUnhealthy.length,
      probed: tlds.length,
    },
    bySource,
    discoveredThisRun: Object.fromEntries(
      Object.keys(discovered)
        .sort()
        .map(tld => [tld, { server: discovered[tld], source: discoveredSource[tld] }])
    ),
    attempts: attempts.sort((a, b) => a.tld.localeCompare(b.tld)),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log('\nby source (adopted / verified / candidates):');
  for (const [name, s] of Object.entries(bySource)) {
    console.log(`  ${name}: ${s.adopted} / ${s.verifiedAlive} / ${s.candidates}`);
  }
  console.log(
    `\ndiscovered ${Object.keys(discovered).length} new working RDAP endpoint(s) in ${elapsed}s ` +
      `(${Object.keys(merged).length} total in the discovered layer)`
  );
  console.log(`proposed diff: data/rdap/dns-discovered.json and data/tlds.json`);
  console.log(`report: registry-health/discovery-rdap.json`);
  console.log(
    `\nnever auto-adopted — review the diff; data/tlds.json, which the library routes by, ` +
      `is already regenerated`
  );
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
