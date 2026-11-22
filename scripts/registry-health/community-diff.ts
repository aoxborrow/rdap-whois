#!/usr/bin/env tsx
// Community server-list diff (docs/registry-health.md, Leg 1 S2–S4) — diff each
// community whois-server map (Debian's rfc1036/whois, weppos/whois) IN FULL against our
// merged committed map. The discovery lane consults these sources only for the problem
// set (dead servers); this lane is the completeness check: TLDs everyone-but-us routes.
//
// Buckets per source:
//   missing-tld       they route it, we have no entry at all (or ours is null) — the
//                     completeness signal, strongest when both sources agree
//   server-disagrees  both route it, different host after normalization
//   we-only           we route it, they don't — usually fine; report-only
//
// Report-only by default: writes registry-health/community-diff.json and prints a
// summary. With --probe (the weekly write-mode run):
//   - probe-verifies missing-tld candidates (capped, both-sources-agreed first) with the
//     same M2 harness the sweep uses; a candidate that probes alive lands in the
//     DISCOVERED layer as a reviewable diff (never TLDs in the phase-out layer — that
//     null is a gated decision). server-disagrees probes annotate only, never adopt.
//   - carries forward known differences in community-known.json: every divergence seen
//     this run is recorded, and only divergences NOT already in the committed file are
//     surfaced as new — merging the weekly PR is what acknowledges them.
//
// Run: npm run registry:community-diff [--probe] [--probe-cap N]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeServer } from '../../src/common/utils';
import { debianWhoisSource } from '../whois/discover/debian-whois';
import { wepposSource } from '../whois/discover/weppos';
import { mergeTldLayers } from '../whois/generate-tlds';
import { probeWhoisServer } from '../whois/probe/whois-probe';
import type { DiscoverySource } from './discovery';
import { runPool } from './state';
import { HEALTH_DIR, WHOIS_DATA_DIR } from '../lib/paths';

const WHOIS_DIR = WHOIS_DATA_DIR;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}community-diff.json`;
const KNOWN_FILE = `${REPORT_DIR}community-known.json`;
const DISCOVERED_FILE = `${WHOIS_DIR}tlds-discovered.json`;

const SOURCES: DiscoverySource[] = [debianWhoisSource, wepposSource];
const DEFAULT_PROBE_CAP = 25;
const PROBE_CONCURRENCY = 4;
const PROBE_PACE_MS = 200;

// a whois server that answers at all is a live candidate (docs/registry-health.md §5)
const ALIVE = new Set(['healthy', 'notfound-fp', 'throttled']);

type MissingTld = { tld: string; server: string; ourEntry: 'absent' | 'null' };
type ServerDisagrees = { tld: string; ours: string; theirs: string };
type SourceDiff = {
  tlds: number;
  missingTld: MissingTld[];
  serverDisagrees: ServerDisagrees[];
  weOnly: string[];
};
type KnownEntry = { server: string; ourServer: string | null; firstSeen: string; lastSeen: string };
type ProbeResult = {
  tld: string;
  host: string;
  sources: string[];
  bucket: 'missing-tld' | 'server-disagrees';
  classification: string;
  adopted: boolean;
  detail?: string;
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function list(label: string, items: string[], detail = 15): void {
  if (!items.length) return;
  const shown = items.slice(0, detail);
  const more = items.length - shown.length;
  console.log(
    `- ${label} (${items.length}): ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
  );
}

async function main(): Promise<void> {
  const started = Date.now();
  const probe = process.argv.includes('--probe');
  const probeCap = Number(getFlag('probe-cap')) || DEFAULT_PROBE_CAP;

  // our merged committed map (all layers, overrides included) — what routing actually is
  const ours = mergeTldLayers();
  const oursNorm = new Map<string, string | null>(
    Object.entries(ours).map(([tld, host]) => [tld, host ? normalizeServer(host) : null])
  );
  const phaseout = loadJson<Record<string, string | null>>(`${WHOIS_DIR}tlds-phaseout.json`, {});

  // ── diff each community map against ours ───────────────────────────────────
  const perSource: Record<string, SourceDiff> = {};
  const theirsBySource = new Map<string, Map<string, string>>();
  for (const source of SOURCES) {
    const theirs = await source.loadAll!();
    theirsBySource.set(source.name, theirs);
    const diff: SourceDiff = { tlds: theirs.size, missingTld: [], serverDisagrees: [], weOnly: [] };
    for (const [tld, host] of theirs) {
      const norm = normalizeServer(host);
      if (!oursNorm.has(tld)) {
        diff.missingTld.push({ tld, server: norm, ourEntry: 'absent' });
      } else if (oursNorm.get(tld) === null) {
        diff.missingTld.push({ tld, server: norm, ourEntry: 'null' });
      } else if (oursNorm.get(tld) !== norm) {
        diff.serverDisagrees.push({ tld, ours: oursNorm.get(tld)!, theirs: norm });
      }
    }
    for (const [tld, host] of oursNorm) {
      if (host && !theirs.has(tld)) diff.weOnly.push(tld);
    }
    diff.missingTld.sort((a, b) => a.tld.localeCompare(b.tld));
    diff.serverDisagrees.sort((a, b) => a.tld.localeCompare(b.tld));
    diff.weOnly.sort();
    perSource[source.name] = diff;
  }

  // missing-tld candidates both sources agree on (same normalized host) — the strongest
  // completeness signal and the head of the probe queue
  const agreedMissing: MissingTld[] = [];
  const [first, ...others] = SOURCES.map(s => perSource[s.name]);
  for (const m of first.missingTld) {
    if (others.every(d => d.missingTld.some(o => o.tld === m.tld && o.server === m.server))) {
      agreedMissing.push(m);
    }
  }

  // ── carry-forward: what's NEW vs the committed known file ──────────────────
  // key = source|bucket|tld — a divergence reviewed once (merged in a weekly PR) stays
  // suppressed until it disappears from upstream; entries no longer present are dropped
  // so a returning divergence surfaces again
  const known = loadJson<Record<string, KnownEntry>>(KNOWN_FILE, {});
  const now = new Date().toISOString();
  const current: Record<string, KnownEntry> = {};
  for (const source of SOURCES) {
    const diff = perSource[source.name];
    for (const m of diff.missingTld) {
      current[`${source.name}|missing-tld|${m.tld}`] = {
        server: m.server,
        ourServer: null,
        firstSeen: now,
        lastSeen: now,
      };
    }
    for (const d of diff.serverDisagrees) {
      current[`${source.name}|server-disagrees|${d.tld}`] = {
        server: d.theirs,
        ourServer: d.ours,
        firstSeen: now,
        lastSeen: now,
      };
    }
  }
  // a divergence is NEW when its key is unseen OR its routing evidence changed — a known
  // entry whose proposed server (or our disagreeing server) moved must resurface for
  // review, not silently update under its reviewed key
  const unchanged = (key: string): boolean =>
    known[key]?.server === current[key].server && known[key]?.ourServer === current[key].ourServer;
  const newKeys = Object.keys(current)
    .filter(key => !unchanged(key))
    .sort();
  for (const [key, entry] of Object.entries(current)) {
    if (unchanged(key)) entry.firstSeen = known[key].firstSeen;
  }

  // ── probe lane (S3, --probe only) ──────────────────────────────────────────
  // missing-tld first (agreed candidates ahead of single-source ones), then
  // server-disagrees for annotation only. Alive missing-tld candidates are appended to
  // the discovered layer — the merge adopts them only via the reviewed weekly PR.
  const probes: ProbeResult[] = [];
  const adopted: Record<string, string> = {};
  if (probe) {
    const sourcesFor = (tld: string, bucket: 'missing' | 'disagrees'): string[] =>
      SOURCES.filter(s =>
        bucket === 'missing'
          ? perSource[s.name].missingTld.some(m => m.tld === tld)
          : perSource[s.name].serverDisagrees.some(d => d.tld === tld)
      ).map(s => s.name);

    // dedupe by tld+host, not tld alone: when the sources propose DIFFERENT hosts for
    // the same missing TLD, each distinct candidate deserves a probe — first alive wins
    // adoption below
    const seen = new Set<string>();
    const queue: Array<Omit<ProbeResult, 'classification' | 'adopted'>> = [];
    const missingQueue = [
      ...agreedMissing,
      ...SOURCES.flatMap(s => perSource[s.name].missingTld).filter(
        m => !agreedMissing.some(a => a.tld === m.tld && a.server === m.server)
      ),
    ];
    for (const m of missingQueue) {
      if (seen.has(`${m.tld}|${m.server}`) || m.tld in phaseout) continue;
      seen.add(`${m.tld}|${m.server}`);
      queue.push({
        tld: m.tld,
        host: m.server,
        sources: sourcesFor(m.tld, 'missing'),
        bucket: 'missing-tld',
      });
    }
    for (const d of SOURCES.flatMap(s => perSource[s.name].serverDisagrees)) {
      if (seen.has(`${d.tld}|${d.theirs}`)) continue;
      seen.add(`${d.tld}|${d.theirs}`);
      queue.push({
        tld: d.tld,
        host: d.theirs,
        sources: sourcesFor(d.tld, 'disagrees'),
        bucket: 'server-disagrees',
      });
    }
    const capped = queue.slice(0, probeCap);
    console.log(`probing ${capped.length}/${queue.length} candidate(s) (cap ${probeCap})…`);

    await runPool(capped, PROBE_CONCURRENCY, PROBE_PACE_MS, async candidate => {
      const outcome = await probeWhoisServer(candidate.host, `nic.${candidate.tld}`);
      const alive = ALIVE.has(outcome.classification);
      // first alive candidate wins the TLD — a later-probing alternate host never
      // overwrites an already-verified adoption, and its probe record must not claim
      // adoption it didn't get
      const won = alive && candidate.bucket === 'missing-tld' && !(candidate.tld in adopted);
      if (won) adopted[candidate.tld] = candidate.host;
      probes.push({
        ...candidate,
        classification: outcome.classification,
        adopted: won,
        ...(outcome.detail && { detail: outcome.detail }),
      });
    });
    probes.sort((a, b) => a.tld.localeCompare(b.tld));

    if (Object.keys(adopted).length) {
      const existing = loadJson<Record<string, string>>(DISCOVERED_FILE, {});
      const merged = Object.fromEntries(
        Object.entries({ ...existing, ...adopted }).sort(([a], [b]) => a.localeCompare(b))
      );
      writeFileSync(DISCOVERED_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    }

    // persist the carry-forward only in write mode — the report-only run compares
    // against the committed file but never advances it
    const sortedKnown = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    );
    writeFileSync(KNOWN_FILE, JSON.stringify(sortedKnown, null, 2) + '\n', 'utf8');
  }

  // ── report ─────────────────────────────────────────────────────────────────
  console.log(`# Community server-list diff\n`);
  for (const source of SOURCES) {
    const diff = perSource[source.name];
    console.log(`## ${source.name} (${diff.tlds} TLDs)`);
    list(
      'missing-tld (they route it, we have nothing)',
      diff.missingTld.map(
        m => `${m.tld} → ${m.server}${m.ourEntry === 'null' ? ' (ours: null)' : ''}`
      )
    );
    list(
      'server-disagrees',
      diff.serverDisagrees.map(d => `${d.tld} (ours ${d.ours}, theirs ${d.theirs})`)
    );
    console.log(`- we-only: ${diff.weOnly.length} (report-only)`);
    console.log('');
  }
  list(
    'agreed missing-tld (both sources, same host — strongest signal)',
    agreedMissing.map(m => `${m.tld} → ${m.server}`)
  );
  list('NEW divergences since last review', newKeys, 25);
  if (probe) {
    const alive = probes.filter(p => ALIVE.has(p.classification));
    console.log(
      `\nprobed ${probes.length} candidate(s): ${alive.length} alive, ` +
        `${Object.keys(adopted).length} appended to the discovered layer (review the diff)`
    );
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    generatedAt: now,
    ourTlds: oursNorm.size,
    perSource,
    agreedMissing,
    newDivergences: newKeys,
    ...(probe && { probes, adopted }),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\nwrote ${REPORT_FILE}`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
