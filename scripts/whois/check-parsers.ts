#!/usr/bin/env tsx
// Offline parser-regression report (docs/registry-health.md M4). Re-parses the whois
// fixture corpus (fixtures/found/*.txt) with the CURRENT engine and diffs the result
// against each committed golden .json — no network, fast. This is the "do our parsers
// still work" machine, revived from the disabled parsing.test-disabled.ts as a report
// CLI (the recurring job is a data pipeline, not a pass/fail test), and it is the P0
// prerequisite + prioritization data for the parser rewrite (docs/archive/whois-parser-refactor.md).
//
// Every field mismatch is bucketed by CAUSE so the rewrite can be prioritized:
//   missing-key          golden has a value, the parser produced null (unmatched field)
//   cross-section-bleed  a contact field got another contact role's value (the section
//                        model's whole reason to exist — see the refactor plan)
//   value-mismatch       both present but different (format/regex drift)
//   unexpected-value     golden is empty, the parser produced something (over-matching)
//   parse-error          parse() threw
//
// Writes registry-health/parsing-fails.json (server → field → cases, a tracked
// path so it shows up in the review diff) + a summary. Fixtures without a golden are
// reported separately, never counted as clean. Exit is report-only (0) unless --strict,
// which fails on any regression among top-100 TLD servers — a slim push-CI gate.
//
// --fixtures <dir> reads another copy of the corpus laid out like fixtures/whois and prints
// the summary without writing anything, so the committed report stays the corpus's own.
//
// Run: npm run whois:check-parsers [--strict] [--server host]
//        [--fixtures dir]
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { parseBlocks } from '../../src/whois/mapping';
import { TOP_100_TLDS } from './lib/top-100';
// golden-comparison semantics are shared with the A/B harness so the P1 gate
// (docs/archive/whois-parser-refactor.md §6) judges both engines by exactly the same rules
import { arraysEqual, assertedFields, fieldMatches, isEmpty, loadGolden } from './compare';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';
import { readFixture } from './lib/raw';

const REPORT_DIR = HEALTH_DIR;

type Bucket =
  'missing-key' | 'cross-section-bleed' | 'value-mismatch' | 'unexpected-value' | 'parse-error';

type FieldFailure = {
  query: string;
  field: string;
  bucket: Bucket;
  expected: unknown;
  result: unknown;
};

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const FIXTURES_FLAG = getFlag('fixtures');
const FOUND_DIR = FIXTURES_FLAG
  ? `${resolve(FIXTURES_FLAG)}/found/`
  : `${WHOIS_FIXTURES_DIR}found/`;

// the contact attribute of a field, e.g. registrantName → "Name" (for bleed detection)
function contactSuffix(field: string): string | null {
  const match = field.match(/^(?:registrant|admin|tech|billing)([A-Z].*)$/);
  return match ? match[1] : null;
}

// classify a mismatch. A contact field whose parsed value matches ANOTHER role's golden
// value for the same attribute is cross-section bleed — the exact failure the block/
// section rewrite targets.
function bucketFor(
  field: string,
  expected: unknown,
  result: unknown,
  golden: Record<string, unknown>
): Bucket {
  if (isEmpty(expected) && !isEmpty(result)) return 'unexpected-value';
  if (!isEmpty(expected) && isEmpty(result)) return 'missing-key';

  const suffix = contactSuffix(field);
  if (suffix && !isEmpty(result)) {
    for (const role of ['registrant', 'admin', 'tech', 'billing']) {
      const otherField = `${role}${suffix}`;
      if (otherField !== field && arraysEqual(golden[otherField], result)) {
        return 'cross-section-bleed';
      }
    }
  }
  return 'value-mismatch';
}

// compare one fixture. null = no golden to compare against (NOT clean — the fixture is
// never actually checked); [] = clean parse; [...] = field failures.
function checkFixture(server: string, query: string): FieldFailure[] | null {
  const golden = loadGolden(FOUND_DIR, server, query);
  if (!golden) return null;

  const raw = readFixture(`${FOUND_DIR}${server}___${query}.txt`);
  let parsed: Record<string, unknown>;
  try {
    parsed = parseBlocks(raw, server, DOMAIN_QUERY_TYPE).data as unknown as Record<string, unknown>;
  } catch (error) {
    return [
      {
        query,
        field: 'parse-error',
        bucket: 'parse-error',
        expected: null,
        result: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const failures: FieldFailure[] = [];
  for (const field of assertedFields(golden)) {
    const expected = golden[field];
    const result = parsed[field];
    if (!fieldMatches(field, expected, result)) {
      failures.push({
        query,
        field,
        bucket: bucketFor(field, expected, result, golden),
        expected,
        result,
      });
    }
  }
  return failures;
}

function main(): void {
  const started = Date.now();
  const only = getFlag('server');
  const strict = process.argv.includes('--strict');

  const fixtures = readdirSync(FOUND_DIR)
    .filter(f => f.endsWith('.txt') && f.includes('___'))
    .map(f => {
      const [server, query] = f.replace(/\.txt$/, '').split('___');
      return { server, query };
    })
    .filter(f => !only || f.server === only)
    .sort((a, b) => `${a.server}${a.query}`.localeCompare(`${b.server}${b.query}`));

  const bucketCounts: Record<Bucket, number> = {
    'missing-key': 0,
    'cross-section-bleed': 0,
    'value-mismatch': 0,
    'unexpected-value': 0,
    'parse-error': 0,
  };
  // server → field → cases (the committed parsing-fails.json shape)
  const serverFails: Record<string, Record<string, FieldFailure[]>> = {};
  let cleanFixtures = 0;
  let top100Regressions = 0;
  const noGolden: string[] = [];

  for (const { server, query } of fixtures) {
    const failures = checkFixture(server, query);
    // a fixture with no golden .json is NOT checked — it must not count as clean, or
    // --strict/registry:health could stay green while corpus entries go unverified
    if (failures === null) {
      noGolden.push(`${server}___${query}`);
      continue;
    }
    if (failures.length === 0) {
      cleanFixtures++;
      continue;
    }
    for (const failure of failures) {
      bucketCounts[failure.bucket]++;
      (serverFails[server] ??= {})[failure.field] ??= [];
      serverFails[server][failure.field].push(failure);
      const tld = query.split('.').pop() ?? '';
      if (TOP_100_TLDS.includes(tld)) top100Regressions++;
    }
  }

  // score is over CHECKED fixtures only (those with a golden), not the raw file count
  const checked = fixtures.length - noGolden.length;
  const failedFixtures = Object.keys(serverFails).length;
  const score = checked ? ((cleanFixtures / checked) * 100).toFixed(1) : '0';
  const totalFailures = Object.values(bucketCounts).reduce((a, b) => a + b, 0);

  // write the detailed failures to a TRACKED path (registry-health/) — the old
  // fixtures/fails/ dir is gitignored (* except .gitignore), so a report there would be
  // silently untracked and absent from the review diff
  const failsFile = `${REPORT_DIR}parsing-fails.json`;
  const hasFailures = Object.keys(serverFails).length > 0;
  if (FIXTURES_FLAG) {
    // another copy of the corpus: the failures go to the terminal, never to a file
    for (const fields of Object.values(serverFails)) {
      for (const failure of Object.values(fields).flat()) {
        const { query, field, bucket, expected, result } = failure;
        console.log(`${query} ${field} [${bucket}]`);
        console.log(`  expected ${JSON.stringify(expected)}`);
        console.log(`  parsed   ${JSON.stringify(result)}`);
      }
    }
  } else if (hasFailures) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(failsFile, JSON.stringify(serverFails, null, 2) + '\n', 'utf8');
  } else if (existsSync(failsFile)) {
    unlinkSync(failsFile);
  }

  // machine-readable summary for the orchestrator / CI
  if (!FIXTURES_FLAG) {
    writeFileSync(
      `${REPORT_DIR}parser-report.json`,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          checked,
          cleanFixtures,
          failedFixtures,
          noGolden: noGolden.length,
          score,
          buckets: bucketCounts,
          top100Regressions,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }

  console.log(
    `\nparser regression: ${cleanFixtures}/${checked} checked fixtures parse clean (${score}%)`
  );
  if (noGolden.length) {
    console.log(`${noGolden.length} fixtures skipped (no golden .json — not counted as clean)`);
  }
  if (totalFailures > 0) {
    console.log(`${totalFailures} field failures across ${failedFixtures} fixtures, by cause:`);
    for (const [bucket, count] of Object.entries(bucketCounts).sort(([, a], [, b]) => b - a)) {
      if (count) console.log(`  ${bucket}: ${count}`);
    }
    // worst servers by failure count — the rewrite's worklist
    const worst = Object.entries(serverFails)
      .map(([server, fields]) => [server, Object.values(fields).flat().length] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    console.log(`\nworst servers:`);
    for (const [server, count] of worst) console.log(`  ${server}: ${count}`);
    if (!FIXTURES_FLAG) console.log(`\nwrote ${failsFile}`);
  }
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);

  if (strict && top100Regressions > 0) {
    console.error(
      `\n🔴 --strict: ${top100Regressions} parser regression(s) on top-100 TLD servers`
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
