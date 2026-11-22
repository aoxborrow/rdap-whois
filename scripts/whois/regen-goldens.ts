#!/usr/bin/env tsx
// Offline golden REBASELINE (docs/archive/whois-parser-refactor.md §6v step 5 / Phase 2). Re-parses every
// found/*.txt that HAS a committed golden .json and rewrites the golden from the CURRENT block
// engine — no network. This is how `check-parsers` goldens are rebaselined after an engine change
// (it was first used to repoint them from the old regex engine, since deleted, to this one).
//
// The rewrite is DIFF-MINIMIZING on purpose (the review reads the golden diff): it preserves each
// file's existing `query`/`server` lead keys (1250 of 1391 carry them; compare.ts skipField never
// compares them) and strips empty/null fields (the majority golden convention — createRequiredData
// nulls absent required fields, but most goldens omit them), so the git diff shows ONLY the fields
// whose values actually changed under the new engine + the format normalization (query/server added
// to the 141 that lacked them, stale nulls dropped from the 97 that stored them).
//
// SAFETY GATES this build in:
//   --dry         don't write; print the semantic field-level diff (loss/lift/change, via the same
//                 compare.ts tolerances the A/B uses) + the cosmetic-only file count.
//   --server host limit to one server.
//
// Run: npm run whois:regen-goldens [--dry] [--server host]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { parseBlocks } from '../../src/whois/mapping';
import { fieldMatches, goldenData, isEmpty, skipField } from './compare';
import { WHOIS_FIXTURES_DIR } from '../lib/paths';
import { readFixture } from './lib/raw';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes('--dry');
const ONLY_SERVER = getFlag('server');

// strip null/undefined/'' /[] so the golden keeps the corpus's "omit empties" convention.
function stripEmpty(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!isEmpty(v)) out[k] = v;
  return out;
}

type Change = {
  file: string;
  field: string;
  kind: 'loss' | 'lift' | 'change';
  from: unknown;
  to: unknown;
};

function main(): void {
  const jsons = readdirSync(FOUND_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !ONLY_SERVER || f.startsWith(`${ONLY_SERVER}___`));

  let written = 0;
  let cosmeticOnly = 0;
  const changes: Change[] = [];

  for (const jf of jsons) {
    const base = jf.slice(0, -'.json'.length);
    const sep = base.indexOf('___');
    const server = base.slice(0, sep);
    const query = base.slice(sep + 3);
    const raw = readFixture(`${FOUND_DIR}${base}.txt`);
    const existing = JSON.parse(readFileSync(`${FOUND_DIR}${jf}`, 'utf8')) as Record<
      string,
      unknown
    >;

    // dates are written as the corpus's date strings, not as Dates
    const parsed = goldenData(
      parseBlocks(raw, server, DOMAIN_QUERY_TYPE).data as unknown as Record<string, unknown>
    );
    const data = stripEmpty(parsed);

    // preserve the file's lead keys exactly as they were (query/server), then the fresh data
    const lead: Record<string, unknown> = {};
    if ('query' in existing) lead.query = existing.query;
    if ('server' in existing) lead.server = existing.server;
    const next = { ...lead, ...data };

    // semantic field-level diff (skip query/server/address/meta; use A/B tolerances)
    const fields = new Set([...Object.keys(existing), ...Object.keys(data)]);
    let real = 0;
    for (const field of fields) {
      if (skipField(field)) continue;
      const before = existing[field];
      const after = data[field];
      if (fieldMatches(field, before, after)) continue;
      real++;
      const kind = isEmpty(after) ? 'loss' : isEmpty(before) ? 'lift' : 'change';
      changes.push({ file: base, field, kind, from: before, to: after });
    }

    const nextStr = JSON.stringify(next, null, 2) + '\n';
    const curStr = readFileSync(`${FOUND_DIR}${jf}`, 'utf8');
    if (nextStr === curStr) continue; // byte-identical, nothing to do
    if (real === 0) cosmeticOnly++;
    if (!DRY) {
      writeFileSync(`${FOUND_DIR}${jf}`, nextStr, 'utf8');
      written++;
    }
  }

  const losses = changes.filter(c => c.kind === 'loss');
  const lifts = changes.filter(c => c.kind === 'lift');
  const vchanges = changes.filter(c => c.kind === 'change');
  console.log(`\nregen over ${jsons.length} goldens${DRY ? ' (DRY)' : ''}`);
  console.log(`  files with a REAL field change: ${new Set(changes.map(c => c.file)).size}`);
  console.log(`  files changed COSMETIC-only (format normalization): ${cosmeticOnly}`);
  console.log(
    `  field changes: ${losses.length} loss · ${lifts.length} lift · ${vchanges.length} value-change`
  );
  if (!DRY) console.log(`  goldens written: ${written}`);

  // losses are the ones that MUST each be a deliberate rebaseline (owner mandate: zero real
  // regression). Print them all so the review can confirm each.
  if (losses.length) {
    console.log(
      `\n  ── LOSSES (golden had a value, the engine now drops/empties it) — confirm each is intended ──`
    );
    for (const c of losses.slice(0, 200)) {
      console.log(`    ${c.file}  ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    }
    if (losses.length > 200) console.log(`    …and ${losses.length - 200} more`);
  }

  if (vchanges.length && process.argv.includes('--show-changes')) {
    console.log(`\n  ── VALUE-CHANGES (both non-empty, differ) — confirm each is a rebaseline ──`);
    for (const c of vchanges) {
      const from = JSON.stringify(c.from);
      const to = JSON.stringify(c.to);
      console.log(`    ${c.file}  ${c.field}: ${from.slice(0, 90)} → ${to.slice(0, 90)}`);
    }
  }
}

main();
