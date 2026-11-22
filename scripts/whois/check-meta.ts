#!/usr/bin/env tsx
// Negative-case lane (docs/archive/whois-parser-refactor.md P1). Runs the engine's anchored
// meta detection (formats/, §4) over every response we hold that should resolve to a meta
// state rather than to domain data, and reports what it detects vs. what the fixture's
// directory says it is.
//
// Why this lane exists at all: the old regex engine's meta detection (since deleted) was an
// over-broad SUBSTRING match — `__notfound` matched "not found" ANYWHERE, including inside
// legal boilerplate; the known false-positive item in docs/archive/tool-improvements.md. The rewrite
// replaced it with per-format ANCHORED patterns, and this is the harness that checks the
// anchored set — above all that it does not fire on the positive corpus, which is the
// failure mode that actually hurts (a registered domain reported as available).
//
// Sources:
//   fixtures/notfound  (1,204)  ours, live
//   fixtures/reserved  (11)     ours, live — thin, hence the vendored supplement
//   fixtures/throttled (32)     ours, live — thin
//   fixtures/vendored/**        weppos (MIT, frozen 2022) + likexian (Apache-2.0, 2026)
//   fixtures/found     (1,391)  ours — the CONTROL: meta must NOT fire here
//   fixtures/unclassified       live responses with no credible parse (P0 sweep) — the
//                               triage pile; whatever meta claims here is a finding
//
// STALENESS RULE: vendored fixtures validate the ENGINE; only a live probe validates the
// PATTERN for a given server today (fixtures/vendored/ATTRIBUTION.md).
//
// Run: npm run whois:check-meta [--verbose]
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectMeta } from '../../src/whois/mapping';
import { resolveFormat, type MetaKind } from '../../src/whois/formats';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';
import { readFixture } from './lib/raw';

const FIXTURES = WHOIS_FIXTURES_DIR;
const REPORT_DIR = HEALTH_DIR;

// dir → the meta state its fixtures SHOULD resolve to (null = must detect nothing)
type Lane = { dir: string; expect: MetaKind | null; label: string; vendored: boolean };
const LANES: Lane[] = [
  { dir: 'notfound', expect: 'notfound', label: 'notfound (ours, live)', vendored: false },
  { dir: 'reserved', expect: 'reserved', label: 'reserved (ours, live)', vendored: false },
  { dir: 'throttled', expect: 'throttled', label: 'throttled (ours, live)', vendored: false },
  // gathered by whois:gather-meta (P2.5): unclassified files whose anchored `servfail`
  // fired, promoted live-timestamped. Scores ~100% by construction (same bias as the other
  // "ours" lanes — they were labelled by the very patterns being measured); it earns honest
  // signal only once a DIFFERENT engine/probe confirms, which is what the vendored + live
  // suspect lanes are for.
  { dir: 'servfail', expect: 'servfail', label: 'servfail (ours, live)', vendored: false },
  {
    dir: 'vendored/weppos/notfound',
    expect: 'notfound',
    label: 'notfound (weppos)',
    vendored: true,
  },
  {
    dir: 'vendored/weppos/reserved',
    expect: 'reserved',
    label: 'reserved (weppos)',
    vendored: true,
  },
  {
    dir: 'vendored/weppos/throttled',
    expect: 'throttled',
    label: 'throttled (weppos)',
    vendored: true,
  },
  {
    dir: 'vendored/likexian/notfound',
    expect: 'notfound',
    label: 'notfound (likexian)',
    vendored: true,
  },
  // the control: a registered-domain response must not trip ANY meta pattern
  { dir: 'found', expect: null, label: 'found — CONTROL, must not fire', vendored: false },
];

function main(): void {
  const verbose = process.argv.includes('--verbose');
  // meta is format-level; generic-kv inherits icann's patterns (formats.ts), so it
  // is the widest net and the right one to judge the pattern set by

  const rows: Array<{
    lane: string;
    total: number;
    hit: number;
    wrong: number;
    miss: number;
  }> = [];
  const misses: Record<string, string[]> = {};
  const wrongs: Record<string, string[]> = {};

  for (const lane of LANES) {
    const dir = `${FIXTURES}${lane.dir}/`;
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.txt'));
    let hit = 0;
    let wrong = 0;
    let miss = 0;

    for (const file of files) {
      const raw = readFixture(dir + file);
      // fixture names are `<server>___<query>.txt` in our lanes, `<host>.txt` in vendored
      const server = file.replace(/\.txt$/, '').split('___')[0];
      const meta = detectMeta(raw, resolveFormat(server), server);
      const kinds = Object.keys(meta) as MetaKind[];

      if (lane.expect === null) {
        // control lane: any detection is a false positive
        if (kinds.length) {
          wrong++;
          (wrongs[lane.label] ??= []).push(`${file} → ${kinds.join('+')} :: ${meta[kinds[0]]}`);
        } else hit++;
        continue;
      }

      if (kinds.includes(lane.expect)) hit++;
      else if (kinds.length) {
        wrong++;
        (wrongs[lane.label] ??= []).push(`${file} → ${kinds.join('+')} (expected ${lane.expect})`);
      } else {
        miss++;
        (misses[lane.label] ??= []).push(file);
      }
    }
    rows.push({ lane: lane.label, total: files.length, hit, wrong, miss });
  }

  // the triage pile is reported, never scored — we don't know what these are yet
  const unclassifiedDir = `${FIXTURES}unclassified/`;
  const triage: Record<string, number> = {};
  let unclassifiedTotal = 0;
  if (existsSync(unclassifiedDir)) {
    for (const file of readdirSync(unclassifiedDir).filter(f => f.endsWith('.txt'))) {
      unclassifiedTotal++;
      const server = file.replace(/\.txt$/, '').split('___')[0];
      const kinds = Object.keys(
        detectMeta(readFixture(unclassifiedDir + file), resolveFormat(server), server)
      );
      const key = kinds.length ? kinds.join('+') : '(none — unparsed format?)';
      triage[key] = (triage[key] ?? 0) + 1;
    }
  }

  console.log(`\n=== meta detection (anchored, per-format) ===\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad('lane', 32)} ${pad('total', 6)} ${pad('ok', 8)} bad`);
  for (const row of rows) {
    console.log(
      `${pad(row.lane, 32)} ${pad(String(row.total), 6)} ${pad(String(row.hit), 8)} ${row.wrong}`
    );
  }
  console.log(
    `\n"bad" = a false positive on the control lane, or the wrong meta state elsewhere.\n` +
      `Undetected (neither state claimed) = total - ok - bad.`
  );

  console.log(`\n=== unclassified triage (${unclassifiedTotal} live responses, P0 sweep) ===`);
  for (const [kind, count] of Object.entries(triage).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${kind}: ${count}`);
  }

  if (verbose) {
    for (const [lane, items] of Object.entries(wrongs)) {
      console.log(`\nwrong — ${lane}:`);
      items.slice(0, 15).forEach(i => console.log(`  ${i}`));
    }
    for (const [lane, items] of Object.entries(misses)) {
      console.log(`\nundetected — ${lane} (first 15 of ${items.length}):`);
      items.slice(0, 15).forEach(i => console.log(`  ${i}`));
    }
  }

  const control = rows.find(r => r.lane.startsWith('found'));
  console.log(`\n── control ──`);
  console.log(
    `  meta must not fire on registered-domain responses: ` +
      `${control && control.wrong === 0 ? '✅ 0 false positives' : `❌ ${control?.wrong} false positives`}`
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    `${REPORT_DIR}meta-report.json`,
    JSON.stringify(
      { checkedAt: new Date().toISOString(), lanes: rows, triage, wrongs, misses },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log(`\nreport: registry-health/meta-report.json`);
  process.exit(0);
}

main();
