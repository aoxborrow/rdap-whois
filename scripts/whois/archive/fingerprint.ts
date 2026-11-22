#!/usr/bin/env tsx
// Format fingerprinting (docs/archive/whois-parser-refactor.md P2). Clusters the found-corpus
// servers by STRUCTURAL fingerprint and validates — or kills — the operator/software
// hypothesis (§3) with data. Output: the candidate format taxonomy, per-server `format`
// assignments (the seed P3 turns into per-server configs), and a coverage table
// (servers × fixtures per format).
//
// This is offline analysis only. It reads the fixture corpus, imports the P1 tokenizer for
// feature extraction, and writes a report. It does NOT touch the old engine, the runtime
// FORMATS registry, or any golden — those stay frozen until P4 (§6).
//
// Method (see fingerprint-features.ts for the pure half):
//   1. fingerprint every fixture, aggregate to a per-server fingerprint (union of markers,
//      modal categorical axes, richest icann-key count);
//   2. assign a WORKING format via the marker→labeled→icann→generic-kv cascade;
//   3. cluster by discrete signature to surface families the cascade lumps together —
//      i.e. test whether `generic-kv` is really one bucket or several latent formats;
//   4. also cluster the unclassified pile (§6b finding 3: 122 responses the current engine
//      can't parse — the honest P2 worklist).
//
// Seeded with weppos's family inventory as priors (§3 footnote): its shared scanners map
// onto our markers — BaseCocca→cocca, RPSL→rpsl, BaseWhoisd→fred — so a match there is
// corroboration, not coincidence. We do NOT hand-assign beyond the anchored markers; the
// clustering is what earns any further split.
//
// Run: npm run whois:fingerprint [--server host] [--limit N]
//      [--min-cluster N] [--verbose]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assignFormat,
  fingerprint,
  signature,
  type Fingerprint,
  type OperatorMarker,
  type WorkingFormat,
} from './fingerprint-features';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../../lib/paths';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;
const UNCLASSIFIED_DIR = `${WHOIS_FIXTURES_DIR}unclassified/`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}format-fingerprints.json`;

// the working taxonomy, in cascade priority order — also the coverage-table row order
const FORMAT_ORDER: WorkingFormat[] = [
  'icann',
  'generic-kv',
  'cocca',
  'rpsl',
  'fred',
  'labeled-blocks',
];

// weppos shared-scanner families (§3 footnote) our markers should line up with — reported
// alongside the marker counts as a corroboration check, not used to assign.
const WEPPOS_PRIORS: Record<OperatorMarker, string> = {
  cocca: 'BaseCocca / BaseCocca2',
  rpsl: 'RPSL object families (RIPE-db ccTLDs, RIRs)',
  fred: 'BaseWhoisd (FRED registry daemon, CZ.NIC)',
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// modal value of a categorical axis across a server's fixtures (ties → first seen, which is
// document order, i.e. the richest/earliest response)
function modal<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// collapse a server's per-fixture fingerprints into one representative. Markers UNION (any
// fixture revealing an operator marker is authoritative), icannKeys MAX (a thin response
// hides the true shape), the rest MODAL.
function aggregate(fps: Fingerprint[]): Fingerprint {
  const markers = [...new Set(fps.flatMap(fp => fp.markers))].sort() as OperatorMarker[];
  return {
    notice: modal(fps.map(fp => fp.notice)),
    separator: modal(fps.map(fp => fp.separator)),
    labels: modal(fps.map(fp => fp.labels)),
    continuations: fps.some(fp => fp.continuations),
    icannKeys: Math.max(...fps.map(fp => fp.icannKeys)),
    blocks: modal(fps.map(fp => fp.blocks)),
    markers,
  };
}

type ServerFingerprint = {
  server: string;
  fixtures: number;
  fingerprint: Fingerprint;
  signature: string;
  format: WorkingFormat;
};

// group `<server>___<query>.txt` fixtures by server
function fixturesByServer(dir: string, only?: string): Map<string, string[]> {
  const byServer = new Map<string, string[]>();
  if (!existsSync(dir)) return byServer;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.txt') || !file.includes('___')) continue;
    const server = file.slice(0, file.indexOf('___'));
    if (only && server !== only) continue;
    (byServer.get(server) ?? byServer.set(server, []).get(server)!).push(file);
  }
  return byServer;
}

function fingerprintServers(dir: string, only?: string, limit?: number): ServerFingerprint[] {
  const byServer = fixturesByServer(dir, only);
  const servers = [...byServer.keys()].sort();
  const sliced = limit ? servers.slice(0, limit) : servers;
  const out: ServerFingerprint[] = [];
  for (const server of sliced) {
    const files = byServer.get(server)!;
    const fps = files.map(file => fingerprint(readFileSync(dir + file, 'utf8')));
    const fp = aggregate(fps);
    out.push({
      server,
      fixtures: files.length,
      fingerprint: fp,
      signature: signature(fp),
      format: assignFormat(fp),
    });
  }
  return out;
}

// a signature cluster: servers sharing an identical discrete fingerprint signature
type Cluster = {
  signature: string;
  servers: string[];
  fixtures: number;
  formats: Set<WorkingFormat>;
};

function cluster(rows: ServerFingerprint[]): Cluster[] {
  const bySig = new Map<string, Cluster>();
  for (const row of rows) {
    const existing =
      bySig.get(row.signature) ??
      bySig
        .set(row.signature, {
          signature: row.signature,
          servers: [],
          fixtures: 0,
          formats: new Set(),
        })
        .get(row.signature)!;
    existing.servers.push(row.server);
    existing.fixtures += row.fixtures;
    existing.formats.add(row.format);
  }
  return [...bySig.values()].sort((a, b) => b.servers.length - a.servers.length);
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function main(): void {
  const started = Date.now();
  const only = getFlag('server');
  const limit = Number(getFlag('limit')) || undefined;
  const minCluster = Number(getFlag('min-cluster')) || 3;
  const verbose = process.argv.includes('--verbose');

  const rows = fingerprintServers(FOUND_DIR, only, limit);
  const totalServers = rows.length;
  const totalFixtures = rows.reduce((n, r) => n + r.fixtures, 0);

  console.log(
    `\n=== P2 format fingerprinting: ${totalServers} servers / ${totalFixtures} fixtures ===\n`
  );

  // ── coverage table ────────────────────────────────────────────────────────────────
  console.log(`── coverage: working format taxonomy ──`);
  console.log(`  ${pad('format', 16)}${pad('servers', 9)}${pad('fixtures', 9)}share`);
  const byFormat = new Map<WorkingFormat, ServerFingerprint[]>();
  for (const row of rows)
    (byFormat.get(row.format) ?? byFormat.set(row.format, []).get(row.format)!).push(row);
  for (const format of FORMAT_ORDER) {
    const group = byFormat.get(format) ?? [];
    if (!group.length) continue;
    const fixtures = group.reduce((n, r) => n + r.fixtures, 0);
    const share = ((group.length / totalServers) * 100).toFixed(1);
    console.log(`  ${pad(format, 16)}${pad(group.length, 9)}${pad(fixtures, 9)}${share}%`);
  }

  // ── operator markers vs weppos priors ───────────────────────────────────────────────
  console.log(`\n── operator markers (vs weppos family priors, §3) ──`);
  for (const marker of ['cocca', 'rpsl', 'fred'] as OperatorMarker[]) {
    const hit = rows.filter(r => r.fingerprint.markers.includes(marker));
    console.log(`  ${pad(marker, 8)}${pad(hit.length, 5)}servers   ≈ ${WEPPOS_PRIORS[marker]}`);
    if (verbose) for (const r of hit) console.log(`        ${r.server}`);
  }

  // ── signature clusters within the icann/generic-kv bulk ─────────────────────────────
  // This is the actual hypothesis test: if `generic-kv` and `icann` are each really ONE
  // format, their servers should collapse into a few dominant signatures. A fat tail of
  // singleton signatures = a lot of bespoke shapes (expected per §6, as long as they ride
  // generic-kv + aliases rather than needing new tokenizers).
  const bulk = rows.filter(r => r.format === 'icann' || r.format === 'generic-kv');
  const clusters = cluster(bulk);
  const named = clusters.filter(c => c.servers.length >= minCluster);
  const tail = clusters.filter(c => c.servers.length < minCluster);
  console.log(`\n── structural clusters within icann + generic-kv (${bulk.length} servers) ──`);
  console.log(
    `  ${clusters.length} distinct signatures; ${named.length} with >=${minCluster} servers, ` +
      `${tail.length} in the singleton/small tail (${tail.reduce((n, c) => n + c.servers.length, 0)} servers)`
  );
  for (const c of named.slice(0, 20)) {
    const formats = [...c.formats].join(',');
    console.log(
      `  ${pad(c.servers.length, 5)}srv ${pad(c.fixtures, 6)}fix  [${formats}]  ${c.signature}`
    );
    if (verbose) console.log(`        e.g. ${c.servers.slice(0, 6).join(', ')}`);
  }

  // ── the unclassified pile (§6b finding 3: the honest P2 worklist) ────────────────────
  const unclassified = fingerprintServers(UNCLASSIFIED_DIR);
  let unclassifiedClusters: Cluster[] = [];
  if (unclassified.length) {
    unclassifiedClusters = cluster(unclassified);
    const uNamed = unclassifiedClusters.filter(c => c.servers.length >= 2);
    console.log(
      `\n── unclassified pile (${unclassified.length} servers the current engine can't parse) ──`
    );
    console.log(
      `  ${unclassifiedClusters.length} distinct signatures; top shapes (a shared signature ` +
        `here = a format worth building an alias table for):`
    );
    for (const c of uNamed.slice(0, 12)) {
      console.log(`  ${pad(c.servers.length, 5)}srv  ${c.signature}`);
      if (verbose) console.log(`        e.g. ${c.servers.slice(0, 6).join(', ')}`);
    }
  }

  // ── write the machine-readable report (per-server assignments = P3's seed) ───────────
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        totals: { servers: totalServers, fixtures: totalFixtures },
        coverage: FORMAT_ORDER.map(format => {
          const group = byFormat.get(format) ?? [];
          return {
            format,
            servers: group.length,
            fixtures: group.reduce((n, r) => n + r.fixtures, 0),
          };
        }).filter(row => row.servers > 0),
        markers: (['cocca', 'rpsl', 'fred'] as OperatorMarker[]).map(marker => ({
          marker,
          wepposPrior: WEPPOS_PRIORS[marker],
          servers: rows.filter(r => r.fingerprint.markers.includes(marker)).map(r => r.server),
        })),
        clusters: cluster(rows).map(c => ({
          signature: c.signature,
          servers: c.servers.length,
          fixtures: c.fixtures,
          formats: [...c.formats],
          examples: c.servers.slice(0, 8),
        })),
        unclassifiedClusters: unclassifiedClusters.map(c => ({
          signature: c.signature,
          servers: c.servers.length,
          examples: c.servers.slice(0, 8),
        })),
        // the deliverable P3 consumes: server -> working format + its signature
        assignments: rows.map(r => ({
          server: r.server,
          format: r.format,
          signature: r.signature,
          fixtures: r.fixtures,
          markers: r.fingerprint.markers,
        })),
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(`\nreport: registry-health/format-fingerprints.json`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main();
