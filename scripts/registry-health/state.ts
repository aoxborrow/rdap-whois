// runPool: process items through a bounded concurrency pool, pacing each worker
// between items. Shared by both probe harnesses for the first pass AND the retry
// round, so retries of a large dead set don't run sequentially (126 dead servers ×
// full timeout would be ~17 min single-threaded).
export async function runPool<T>(
  items: T[],
  concurrency: number,
  paceMs: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
        await new Promise(resolve => setTimeout(resolve, paceMs));
      }
    })
  );
}

// Random N-of-M sample: pick n distinct items uniformly at random. Fisher-Yates
// partial shuffle (unbiased — unlike `sort(() => Math.random() - 0.5)`). Used by the
// probe harnesses' `--sample` flag so the light weekly CI sweep exercises a fresh random
// slice of servers each run rather than the same alphabetical head (docs/archive/registry-health-ci.md).
export function sampleN<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items.slice();
  const copy = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Committed probe state for the registry-health lane (registry-health/state.json).
// One record per probed whois server / RDAP base URL, carrying the consecutive-failure
// counter the M3 decision rules read (docs/registry-health.md §5-6). The file is
// committed with each run's PR, so failure history is auditable in git — no external
// storage. Throttled/notfound classifications are ALIVE signals and reset the counter;
// failures increment it, and a change between phase-out evidence (a connection failure or
// a refusal) and an odd answer starts it again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { HEALTH_DIR } from '../lib/paths';

const STATE_DIR = HEALTH_DIR;
const STATE_FILE = `${STATE_DIR}state.json`;

// probe classification per docs/registry-health.md §5
export type ProbeClassification =
  | 'healthy' // answered and parsed
  | 'notfound-fp' // alive, but notfound for a known-registered probe (parser/probe finding)
  | 'throttled' // alive, rate-limited — never counts as failure
  | 'suspect' // empty/non-conformant response — counted separately from dead
  | 'dead-candidate' // timeout/connection failure — increments consecutive failures
  | 'refused' // answered with an error page instead of a record ("TLD is not supported.") — counts as failure
  | 'error'; // unexpected error shape — investigate, counts as failure

export type ProbeRecord = {
  classification: ProbeClassification;
  consecutiveFailures: number;
  // first time we ever probed this server; lets "never worked" age for the time-based
  // phase-out gate (§10.3) when lastHealthyAt is null. Backfilled from lastProbeAt for
  // pre-§10.3 state on load.
  firstProbeAt: string;
  lastProbeAt: string;
  lastHealthyAt: string | null;
  probeQuery: string | null;
  // whois: count of non-null DOMAIN_REQUIRED_FIELDS parsed from the probe response;
  // rdap: null (liveness only)
  score: number | null;
  detail: string | null;
};

export type HealthState = {
  updatedAt: string;
  whois: Record<string, ProbeRecord>;
  rdap: Record<string, ProbeRecord>;
};

const ALIVE: ProbeClassification[] = ['healthy', 'notfound-fp', 'throttled'];

// the failures the phase-out gate counts (scripts/whois/decide.ts)
const PHASEOUT_EVIDENCE: ProbeClassification[] = ['dead-candidate', 'refused'];

export function loadState(): HealthState {
  if (!existsSync(STATE_FILE)) {
    return { updatedAt: '', whois: {}, rdap: {} };
  }
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as HealthState;
  // migrate pre-§10.3 records that predate firstProbeAt: the earliest signal we have for
  // "how long we've been seeing this server" is its lastProbeAt (idempotent once set).
  for (const records of [state.whois, state.rdap]) {
    for (const record of Object.values(records)) {
      if (!record.firstProbeAt) record.firstProbeAt = record.lastProbeAt;
    }
  }
  return state;
}

// canonical field order for a record — so migrated (backfilled) and freshly-probed
// records serialize identically and the committed diff stays a clean, reviewable insert
function orderRecord(r: ProbeRecord): ProbeRecord {
  return {
    classification: r.classification,
    consecutiveFailures: r.consecutiveFailures,
    firstProbeAt: r.firstProbeAt,
    lastProbeAt: r.lastProbeAt,
    lastHealthyAt: r.lastHealthyAt,
    probeQuery: r.probeQuery,
    score: r.score,
    detail: r.detail,
  };
}

export function saveState(state: HealthState): void {
  state.updatedAt = new Date().toISOString();
  // stable key + field order keeps the committed diff reviewable
  const sortRecords = (records: Record<string, ProbeRecord>): Record<string, ProbeRecord> =>
    Object.fromEntries(
      Object.entries(records)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([host, record]) => [host, orderRecord(record)])
    );
  const sorted: HealthState = {
    updatedAt: state.updatedAt,
    whois: sortRecords(state.whois),
    rdap: sortRecords(state.rdap),
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

// fold one probe outcome into the state record for a server
export function recordProbe(
  records: Record<string, ProbeRecord>,
  server: string,
  outcome: {
    classification: ProbeClassification;
    probeQuery: string | null;
    score?: number | null;
    detail?: string | null;
  }
): ProbeRecord {
  const now = new Date().toISOString();
  const previous = records[server];
  const alive = ALIVE.includes(outcome.classification);
  // a failure streak carries on only while the failures are of one kind: phase-out evidence
  // (a connection failure or a refusal) or not (an odd answer), so the phase-out gate's
  // count is never made up of failures that are not evidence
  const streak =
    previous &&
    PHASEOUT_EVIDENCE.includes(previous.classification) ===
      PHASEOUT_EVIDENCE.includes(outcome.classification)
      ? previous.consecutiveFailures
      : 0;
  const record: ProbeRecord = {
    classification: outcome.classification,
    consecutiveFailures: alive ? 0 : streak + 1,
    firstProbeAt: previous?.firstProbeAt ?? now,
    lastProbeAt: now,
    lastHealthyAt: alive ? now : (previous?.lastHealthyAt ?? null),
    probeQuery: outcome.probeQuery,
    score: outcome.score ?? null,
    detail: outcome.detail ?? null,
  };
  records[server] = record;
  return record;
}
