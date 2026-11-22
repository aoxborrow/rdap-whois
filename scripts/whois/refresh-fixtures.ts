#!/usr/bin/env tsx
// Refresh the stalest whois fixtures against live registries (docs/registry-health.md
// M4). The whole corpus is stamped 2025-03/04 — every fixture is stale under the
// repo's own isStale(90d). This re-records the N oldest (by the ###%%% TME header) in
// bounded batches so the corpus creeps forward without a giant one-shot diff, and the
// parser-regression harness (whois:check-parsers) stays meaningful.
//
// Per fixture, through the library client (proxy, each server's own query string):
//   - a clean live response → overwrite raw .txt + golden .json; if the required-field
//     set changed by more than date drift, FLAG it (structural drift worth review)
//   - notfound / dead / throttled → don't touch the fixture; add it to the committed
//     quarantine (registry-health/fixture-quarantine.json) so later runs skip it
//     (successor to refresh-fixtures.ts's hand-maintained SKIP_FIXTURES)
//
// Run: npm run whois:refresh-fixtures [--limit N] [--server host]
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { DOMAIN_REQUIRED_FIELDS } from '../../src/whois/base';
import { isDateField } from './compare';
import { addRawMetadata, parseRawMetadata } from './lib/raw';
import { toolingClient } from '../lib/client';
import { runPool } from '../registry-health/state';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';
import { recordedFixture } from './lib/fixture';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;
const QUARANTINE_FILE = `${HEALTH_DIR}fixture-quarantine.json`;

const DEFAULT_LIMIT = 25;
const CONCURRENCY = 6;
const PACE_MS = 150;
const QUERY_TIMEOUT_MS = 10000;

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// fixture age in ms from its TME metadata header (missing/unparseable → treat as oldest)
function fixtureAge(server: string, query: string): number {
  try {
    const meta = parseRawMetadata(readFileSync(`${FOUND_DIR}${server}___${query}.txt`, 'utf8'));
    if (!meta.timestamp) return Infinity;
    const t = new Date(meta.timestamp).getTime();
    return isNaN(t) ? Infinity : Date.now() - t;
  } catch {
    return Infinity;
  }
}

// which required fields differ beyond date drift (structural change worth a look)
function structuralDrift(
  oldGolden: Record<string, unknown>,
  newData: Record<string, unknown>
): string[] {
  const drift: string[] = [];
  for (const field of DOMAIN_REQUIRED_FIELDS) {
    if (isDateField(field)) continue; // dates always drift; that's expected
    const before = JSON.stringify(oldGolden[field] ?? null);
    const after = JSON.stringify(newData[field] ?? null);
    if (before !== after) drift.push(field);
  }
  return drift;
}

async function main(): Promise<void> {
  const started = Date.now();
  const limit = Number(getFlag('limit')) || DEFAULT_LIMIT;
  const only = getFlag('server');

  const quarantine = new Set<string>(
    existsSync(QUARANTINE_FILE)
      ? (JSON.parse(readFileSync(QUARANTINE_FILE, 'utf8')) as string[])
      : []
  );

  const candidates = readdirSync(FOUND_DIR)
    .filter(f => f.endsWith('.txt') && f.includes('___'))
    .map(f => f.replace(/\.txt$/, ''))
    .filter(name => !quarantine.has(name))
    .map(name => {
      const [server, query] = name.split('___');
      return { name, server, query };
    })
    .filter(f => !only || f.server === only);

  // oldest first, take the batch
  candidates.sort((a, b) => fixtureAge(b.server, b.query) - fixtureAge(a.server, a.query));
  const batch = candidates.slice(0, limit);
  console.log(
    `refreshing ${batch.length} of ${candidates.length} eligible fixtures (oldest first)`
  );

  const refreshed: string[] = [];
  const drifted: string[] = [];
  const quarantined: string[] = [];

  const client = toolingClient();
  await runPool(batch, CONCURRENCY, PACE_MS, async ({ name, server, query }) => {
    try {
      const [hop] = await client.whois(query, {
        server,
        followReferrals: 0,
        timeout: QUERY_TIMEOUT_MS,
      });
      // a dead/gone (notfound, reserved) domain can't be a found-corpus fixture →
      // quarantine it instead of overwriting with junk
      if (!hop?.raw || hop.status !== 'found') {
        quarantine.add(name);
        quarantined.push(`${name} (${hop?.raw ? hop.status : 'no response'})`);
        return;
      }
      const raw = addRawMetadata(query, server, new Date().toISOString(), hop.raw);

      const oldGolden = JSON.parse(readFileSync(`${FOUND_DIR}${name}.json`, 'utf8')) as Record<
        string,
        unknown
      >;
      // the golden is built from the text that goes on disk
      const { text, data: newData } = recordedFixture(raw, server);
      const drift = structuralDrift(oldGolden, newData);

      writeFileSync(`${FOUND_DIR}${name}.txt`, text, 'utf8');
      writeFileSync(
        `${FOUND_DIR}${name}.json`,
        JSON.stringify({ query, server, ...newData }, null, 2) + '\n',
        'utf8'
      );
      refreshed.push(name);
      if (drift.length) drifted.push(`${name} — ${drift.join(', ')}`);
    } catch (error) {
      // throttled / connection error: leave the fixture untouched, don't quarantine
      // (transient) — just report it wasn't refreshed this run
      console.log(`  skip ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  mkdirSync(HEALTH_DIR, { recursive: true });
  writeFileSync(QUARANTINE_FILE, JSON.stringify([...quarantine].sort(), null, 2) + '\n', 'utf8');

  console.log(
    `\nrefreshed ${refreshed.length}, quarantined ${quarantined.length}, in ${Math.round((Date.now() - started) / 1000)}s`
  );
  if (drifted.length) {
    console.log(`\nstructural drift (review these goldens):`);
    drifted.forEach(d => console.log(`  ${d}`));
  }
  if (quarantined.length) {
    console.log(`\nquarantined (gone/notfound, skipped next run):`);
    quarantined.forEach(q => console.log(`  ${q}`));
  }
  console.log(`\nnext: npm run whois:check-parsers`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
