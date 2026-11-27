#!/usr/bin/env tsx
// `npm run whois:discover` (docs/registry-health.md §10.4) — look for replacement whois
// servers for TLDs whose routed server is dead, beyond IANA. Sources: Debian
// `tld_serv_list` + weppos/whois — community lists often ahead of IANA (the origin of many
// existing overrides).
//
// Input is the PROBLEM SET, not all TLDs: TLDs whose routed whois server last probed
// dead-candidate. Each candidate is probe-VERIFIED with the same M2 harness the sweep uses
// (probeWhoisServer — healthy/notfound-fp/throttled all mean the port-43 server answered).
// Verified replacements are written to the whois DISCOVERED layer
// (data/whois/tlds-discovered.json) — symmetric with the RDAP discovered
// layer: `whois:generate` merges it (ascii ← extra ← auto ← discovered ← phaseout ←
// overrides), so merging the PR adopts the routes with no manual fold-in. The committed
// diff is the review gate. A discovery-whois.json report captures every attempt.
//
// Run: npm run whois:discover [--limit N] [--tld a,b,c]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeProblemSet } from '../registry-health/problem-set';
import { debianWhoisSource } from './discover/debian-whois';
import { wepposSource } from './discover/weppos';
import { summarizeBySource, type DiscoverySource } from '../registry-health/discovery';
import { probeWhoisServer } from './probe/whois-probe';
import { runPool } from '../registry-health/state';
import { HEALTH_DIR, WHOIS_DATA_DIR } from '../lib/paths';
import { writeTlds } from './generate-tlds';

const DISCOVERED_FILE = `${WHOIS_DATA_DIR}tlds-discovered.json`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}discovery-whois.json`;

const SOURCES: DiscoverySource[] = [debianWhoisSource, wepposSource];
const CONCURRENCY = 4;
const PACE_MS = 200;

// a whois server that answers at all is a live candidate (docs §5)
const ALIVE = new Set(['healthy', 'notfound-fp', 'throttled']);

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

type Attempt = {
  tld: string;
  source: string;
  host: string;
  classification: string;
  detail?: string;
};

async function main(): Promise<void> {
  const started = Date.now();
  const problem = computeProblemSet();

  const only = getFlag('tld');
  let targets = problem.deadWhois;
  if (only) {
    const set = new Set(only.split(',').map(t => t.trim().toLowerCase()));
    targets = targets.filter(t => set.has(t.tld));
  }
  const limit = Number(getFlag('limit')) || undefined;
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `whois:discover — ${targets.length} dead-whois TLD(s)` +
      `\nsources: ${SOURCES.map(s => s.name).join(', ')}`
  );

  const attempts: Attempt[] = [];
  const discovered: Record<string, string> = {};
  const discoveredSource: Record<string, string> = {};
  let done = 0;

  await runPool(targets, CONCURRENCY, PACE_MS, async ({ tld, server }) => {
    for (const source of SOURCES) {
      let candidate: { servers: string[] };
      try {
        candidate = await source.lookup(tld);
      } catch (error) {
        attempts.push({
          tld,
          source: source.name,
          host: '',
          classification: 'error',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const host of candidate.servers) {
        // no point re-probing the server we already know is dead
        if (host.toLowerCase() === server.toLowerCase()) continue;
        const outcome = await probeWhoisServer(host, `nic.${tld}`);
        attempts.push({
          tld,
          source: source.name,
          host,
          classification: outcome.classification,
          detail: outcome.detail,
        });
        if (ALIVE.has(outcome.classification) && !discovered[tld]) {
          discovered[tld] = host;
          discoveredSource[tld] = source.name;
          console.log(`  ✓ ${tld} → ${host} (${source.name}, ${outcome.classification})`);
        }
      }
    }
    if (++done % 25 === 0) console.log(`  …${done}/${targets.length} probed`);
  });

  // discovered layer — verified replacement servers, merged into data/tlds.json
  // (ascii ← extra ← auto ← discovered ← phaseout ← overrides). The job only appends
  // verified-alive servers here; merging the PR adopts them. Merge with prior, sorted.
  const existing: Record<string, string> = existsSync(DISCOVERED_FILE)
    ? (JSON.parse(readFileSync(DISCOVERED_FILE, 'utf8')) as Record<string, string>)
    : {};
  const merged = { ...existing, ...discovered };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DISCOVERED_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  writeTlds();

  // per-source productivity — a source stuck at 0 across runs only echoes IANA/another
  // source and can be dropped (§10.4). alive = the discovery adoption criterion.
  const bySource = summarizeBySource(
    SOURCES.map(s => s.name),
    attempts.map(a => ({
      source: a.source,
      candidate: Boolean(a.host),
      alive: ALIVE.has(a.classification),
    })),
    discoveredSource
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map(s => s.name),
    input: { deadWhois: problem.deadWhois.length, probed: targets.length },
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
    `\ndiscovered ${Object.keys(discovered).length} replacement whois server(s) in ${elapsed}s ` +
      `(${Object.keys(merged).length} total in the discovered layer)`
  );
  console.log(`discovered layer: data/whois/tlds-discovered.json`);
  console.log(`report: ${REPORT_FILE}`);
  console.log(`\nreview the diff; data/tlds.json is already regenerated (merge adopts)`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
