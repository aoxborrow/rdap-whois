// The throttling the health sweep sees, kept per server across runs
// (registry-health/throttling.json), so the per-server limits the library ships
// (data/limits.json) can be checked against what registries actually do. A server that
// throttles a single probe a week, run after run, is a candidate for an entry of its own.
//
// Each probe lane folds its outcomes in after a run: a server that throttled gets its count
// raised and its latest detail; one that answered keeps its history. The limit the library
// applied to it is written beside, so a throttle under a published limit stands out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SERVER_LIMIT, KNOWN_SERVER_LIMITS, type ServerLimit } from '../../src/net/limiter';
import { HEALTH_DIR } from '../lib/paths';
import type { ProbeClassification } from './state';

const THROTTLING_FILE = `${HEALTH_DIR}throttling.json`;

export type ThrottleRecord = {
  protocol: 'whois' | 'rdap';
  // how many runs this server throttled a probe in
  runs: number;
  firstSeen: string;
  lastSeen: string;
  detail: string | null;
  // the limit the library applied to the server when it last throttled
  limit: ServerLimit;
  // whether that limit is one its registry publishes
  published: boolean;
};

export type Throttling = Record<string, ThrottleRecord>;

export function loadThrottling(): Throttling {
  return existsSync(THROTTLING_FILE)
    ? (JSON.parse(readFileSync(THROTTLING_FILE, 'utf8')) as Throttling)
    : {};
}

// the hostname a probe went to: a WHOIS server is one already, an RDAP base is a URL
export function hostOf(server: string): string {
  return /^https?:\/\//i.test(server) ? new URL(server).hostname.toLowerCase() : server;
}

// fold one lane's outcomes in. Returns the servers that throttled this run
export function recordThrottling(
  throttling: Throttling,
  protocol: 'whois' | 'rdap',
  outcomes: Iterable<[string, { classification: ProbeClassification; detail?: string }]>,
  now = new Date()
): string[] {
  const seen: string[] = [];
  for (const [server, outcome] of outcomes) {
    if (outcome.classification !== 'throttled') continue;
    const host = hostOf(server);
    const known = KNOWN_SERVER_LIMITS[host];
    const previous = throttling[host];
    throttling[host] = {
      protocol,
      runs: (previous?.runs ?? 0) + 1,
      firstSeen: previous?.firstSeen ?? now.toISOString(),
      lastSeen: now.toISOString(),
      detail: outcome.detail ?? null,
      limit: { ...(known ?? DEFAULT_SERVER_LIMIT) },
      published: Boolean(known),
    };
    seen.push(host);
  }
  return seen.sort();
}

export function saveThrottling(throttling: Throttling): void {
  const sorted = Object.fromEntries(
    Object.entries(throttling).sort(([a], [b]) => a.localeCompare(b))
  );
  mkdirSync(HEALTH_DIR, { recursive: true });
  writeFileSync(THROTTLING_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

// the lane's outcomes folded into the committed file, unless the run saves nothing
export function persistThrottling(
  protocol: 'whois' | 'rdap',
  outcomes: Iterable<[string, { classification: ProbeClassification; detail?: string }]>,
  save: boolean
): void {
  const throttling = loadThrottling();
  const seen = recordThrottling(throttling, protocol, outcomes);
  if (seen.length) {
    console.log(`\nthrottled this run (${seen.length}): ${seen.join(', ')}`);
  }
  if (save) saveThrottling(throttling);
}
