#!/usr/bin/env tsx
// Refresh the machine-discovered TLD → whois-server layer (servers/tlds-auto.json)
// from IANA, the authoritative source:
//   1. fetch the official TLD list (data.iana.org/TLD/tlds-alpha-by-domain.txt)
//   2. query whois.iana.org for each TLD and extract its `whois:` referral line
//      (through the library client: proxy routing, retries, the per-server limits)
//   3. write servers/tlds-auto.json (tld → server, or null when IANA lists the TLD
//      without a whois server) + a sweep report to registry-health/iana-sweep.json
//
// Failed queries are retried once at the end; still-failing TLDs are EXCLUDED from
// tlds-auto.json (the merge keeps whatever the static layers say) and listed in the
// sweep report — a network hiccup must never null out a working server. If more than
// 10% of queries fail, nothing is written at all.
//
// The merge semantics live in generate-tlds.ts: an auto server beats the static
// snapshot, but an auto null never clobbers an existing entry — phasing out a server
// requires probe evidence + IANA agreement (docs/registry-health.md §6), which is the
// M2/M3 decision engine's job, not this sweep's.
//
// Run:  npm run whois:update-tlds [--limit N] [--concurrency N]
// It regenerates data/tlds.json; commit both diffs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IANA_WHOIS_SERVER } from '../../src/whois/constants';
import { parseReferralServer } from '../../src/whois/servers';
import { toolingClient } from '../lib/client';
import { HEALTH_DIR, WHOIS_DATA_DIR } from '../lib/paths';
import { writeTlds } from './generate-tlds';

const IANA_TLD_LIST_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';

const AUTO_FILE = `${WHOIS_DATA_DIR}tlds-auto.json`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}iana-sweep.json`;

// pacing per worker between queries; IANA is tolerant and the proxy rotates egress
// IPs per connection, but there's no reason to hammer the root registry
const PACE_MS = 250;
const DEFAULT_CONCURRENCY = 3;
const QUERY_TIMEOUT_MS = 10000;
const MAX_FAILURE_RATIO = 0.1;

type SweepEntry = {
  server: string | null;
  status: string | null; // IANA `status:` line, e.g. ACTIVE / RETIRED
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function fetchTldList(): Promise<string[]> {
  const response = await fetch(IANA_TLD_LIST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch IANA TLD list: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.toLowerCase());
}

const client = toolingClient();

// query whois.iana.org for one TLD and extract the whois referral + status
async function queryIana(tld: string): Promise<SweepEntry> {
  const [hop] = await client.whois(tld, {
    server: IANA_WHOIS_SERVER,
    followReferrals: 0,
    timeout: QUERY_TIMEOUT_MS,
  });
  if (!hop?.raw) {
    throw new Error(`empty response for ${tld}`);
  }
  if (hop.status === 'error') {
    throw new Error(`${IANA_WHOIS_SERVER} answered with an error for ${tld}`);
  }
  // a notfound response from IANA still answers the question: no whois server
  const server = hop.status === 'notfound' ? null : parseReferralServer(hop.raw);
  const status = hop.raw.match(/^status:\s+(.+)\s*$/m)?.[1] ?? null;
  return { server, status };
}

// tiny concurrency pool; items are pulled in order, each worker paces itself
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
        await new Promise(resolve => setTimeout(resolve, PACE_MS));
      }
    })
  );
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || undefined;
  const concurrency = Number(getFlag('concurrency')) || DEFAULT_CONCURRENCY;

  const allTlds = await fetchTldList();
  const tlds = limit ? allTlds.slice(0, limit) : allTlds;
  console.log(`IANA lists ${allTlds.length} TLDs${limit ? `, sweeping first ${tlds.length}` : ''}`);

  const entries = new Map<string, SweepEntry>();
  const failed = new Map<string, string>();
  let done = 0;

  const sweep = async (tld: string) => {
    try {
      entries.set(tld, await queryIana(tld));
      failed.delete(tld);
    } catch (error) {
      failed.set(tld, error instanceof Error ? error.message : String(error));
    }
    done++;
    if (done % 100 === 0) {
      console.log(`  ${done}/${tlds.length} (failures so far: ${failed.size})`);
    }
  };

  await runPool(tlds, concurrency, sweep);

  // one retry round for transient failures (throttle, dead proxy exit, timeout)
  if (failed.size > 0) {
    const retries = [...failed.keys()];
    console.log(`retrying ${retries.length} failed queries...`);
    await runPool(retries, 1, sweep);
  }

  if (failed.size > tlds.length * MAX_FAILURE_RATIO) {
    console.error(
      `${failed.size}/${tlds.length} queries failed — refusing to write results ` +
        '(network/proxy problem, not registry truth)'
    );
    process.exit(1);
  }

  // tlds-auto.json: plain tld → server|null map, sorted, mergeable by generate-tlds.
  // Successful queries (including IANA-null) use the fresh value. For a TLD that FAILED
  // this run (network blip, not registry truth), carry forward its PRIOR auto entry
  // rather than dropping it — otherwise a previously-discovered repoint silently reverts
  // to stale static on the next generate. (Still-failing TLDs with no prior entry are
  // omitted, so the static layer answers, exactly as before.)
  const existingAuto: Record<string, string | null> = existsSync(AUTO_FILE)
    ? (JSON.parse(readFileSync(AUTO_FILE, 'utf8')) as Record<string, string | null>)
    : {};
  const autoEntries = new Map<string, string | null>();
  for (const [tld, entry] of entries) autoEntries.set(tld, entry.server);
  let carriedForward = 0;
  for (const tld of failed.keys()) {
    if (!autoEntries.has(tld) && tld in existingAuto) {
      autoEntries.set(tld, existingAuto[tld]);
      carriedForward++;
    }
  }
  const auto = Object.fromEntries(
    [...autoEntries.keys()].sort().map(tld => [tld, autoEntries.get(tld) ?? null])
  );
  writeFileSync(AUTO_FILE, JSON.stringify(auto, null, 2) + '\n', 'utf8');
  writeTlds();

  // sweep report: per-TLD status + failures, for the cross-diff and the PR body
  const withWhois = Object.values(auto).filter(Boolean).length;
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    source: IANA_TLD_LIST_URL,
    sweptAt: new Date().toISOString(),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    totals: {
      tlds: tlds.length,
      withWhois,
      withoutWhois: Object.keys(auto).length - withWhois,
      failed: failed.size,
      carriedForward,
    },
    failed: Object.fromEntries([...failed.entries()].sort()),
    entries: Object.fromEntries([...entries.keys()].sort().map(tld => [tld, entries.get(tld)!])),
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(
    `swept ${entries.size} TLDs in ${report.elapsedSeconds}s: ` +
      `${withWhois} with whois, ${Object.keys(auto).length - withWhois} without, ` +
      `${failed.size} failed${carriedForward ? ` (${carriedForward} prior entries carried forward)` : ''}`
  );
  console.log(`wrote ${AUTO_FILE}`);
  console.log(`wrote ${REPORT_FILE}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
