#!/usr/bin/env tsx
// Corpus alias mining (docs/archive/whois-parser-refactor.md P3, "global alias table mined from the
// corpus: every key string observed → candidate canonical field"). This is the data-first
// heart of the refactor: instead of hand-writing regexes, we learn which raw key produces
// which canonical field by OBSERVING it — a key is only proposed as an alias for a field
// when its raw value literally MATCHES that field's golden value. No guessing.
//
// Method, per found fixture (raw + golden .json):
//   1. tokenize the raw into (key, value) entries;
//   2. for each canonical field the golden asserts a value for, find the raw entry whose
//      value matches that golden value (under the corpus's own tolerances — datesEquivalent
//      for dates, membership for arrays, trimmed equality otherwise);
//   3. that (normalizedKey → field) pairing is one piece of evidence, tallied across servers.
// A candidate alias is then any pairing whose key the CURRENT format tables don't already
// claim for that field — i.e. a key we'd currently drop to the drift set that in fact
// carries a real field value. Ranked by how many distinct servers show it (breadth beats
// raw count: a spelling on 40 servers matters more than one server's 40 fixtures).
//
// Ambiguity guard: a key that maps to DIFFERENT fields on different servers (e.g. `id:` →
// domainId here, registrantId there) is NOT auto-foldable — it is reported under
// `ambiguous` for human/AI review, never silently added.
//
// Cross-checked against likexian/whois-parser's `keyRule` global alias table (Apache-2.0,
// maintained through 2026 — §9b) so the fold flags which mined aliases prior art corroborates
// vs. which are ours alone. Prior art is corroboration, never the source: everything here is
// earned from OUR corpus's golden values.
//
// Offline analysis. Touches no runtime engine, no golden. Output:
// registry-health/alias-candidates.json.
//
// Run: npm run whois:mine-aliases [--min-servers N] [--field f]
//      [--verbose]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARRAY_FIELDS, DATE_FIELDS } from '../../../src/whois/base';
import { tokenize, allEntries } from '../../../src/whois/blocks';
import { normalizeKey } from '../../../src/whois/mapping';
import { GENERIC_KV_ALIASES } from '../../../src/whois/formats';
import { datesEquivalent, isEmpty, loadGolden, skipField } from '../compare';
import { likexianField } from './seeds/likexian-key-rule';
import { HEALTH_DIR, WHOIS_FIXTURES_DIR } from '../../lib/paths';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;
const REPORT_DIR = HEALTH_DIR;
const REPORT_FILE = `${REPORT_DIR}alias-candidates.json`;

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

// keys the current generic-kv table already claims for a field: (normalizedKey → Set<field>).
// generic-kv is the widest runtime table (inherits icann + the non-ICANN extras), so a key
// it already maps is not a NEW candidate.
function currentlyMapped(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [field, keys] of Object.entries(GENERIC_KV_ALIASES)) {
    for (const key of keys) {
      const norm = normalizeKey(key);
      (map.get(norm) ?? map.set(norm, new Set()).get(norm)!).add(field);
    }
  }
  return map;
}

// does a raw entry value match the golden value for this field, under the corpus tolerances?
// (the mirror of compare.fieldMatches, but one-directional: raw value → asserted golden)
function valueMatches(field: string, rawValue: string, golden: unknown): boolean {
  const value = rawValue.trim();
  if (!value) return false;
  if (DATE_FIELDS.includes(field)) return datesEquivalent(value, golden);
  if (ARRAY_FIELDS.includes(field)) {
    const arr = Array.isArray(golden) ? golden.map(v => String(v).trim().toLowerCase()) : [];
    return arr.includes(value.toLowerCase());
  }
  return value.toLowerCase() === String(golden).trim().toLowerCase();
}

type Evidence = { servers: Set<string>; occurrences: number; examples: string[] };

function main(): void {
  const started = Date.now();
  const minServers = Number(getFlag('min-servers')) || 3;
  const onlyField = getFlag('field');
  const verbose = process.argv.includes('--verbose');

  const mapped = currentlyMapped();
  // (normalizedKey → field → evidence)
  const evidence = new Map<string, Map<string, Evidence>>();

  const files = readdirSync(FOUND_DIR).filter(f => f.endsWith('.txt') && f.includes('___'));
  let fixtures = 0;
  for (const file of files) {
    const [server, query] = file.replace(/\.txt$/, '').split('___');
    const golden = loadGolden(FOUND_DIR, server, query);
    if (!golden) continue;
    fixtures++;
    const raw = readFileSync(FOUND_DIR + file, 'utf8');
    const entries = allEntries(tokenize(raw));
    // the (field, value) pairs this golden asserts — the search space for a value match
    const asserted = Object.entries(golden).filter(
      ([field, value]) => !skipField(field) && !isEmpty(value)
    );

    // REPEATED-VALUE GUARD: the unique-value guard below counts matches against ASSERTED
    // golden fields, but a golden often asserts only ONE of the several fields a response
    // repeats a value under (`Registrant Email:`/`Admin Email:`/`Tech Email:` all carrying
    // the same redaction string, with only registrantEmail asserted). A value that appears
    // under 2+ distinct keys in the SAME response pins nothing — index the response's
    // value→keys up front and reject those entries before they tally as evidence.
    const keysByValue = new Map<string, Set<string>>();
    for (const entry of entries) {
      const value = entry.value.trim().toLowerCase();
      if (!value) continue;
      (keysByValue.get(value) ?? keysByValue.set(value, new Set()).get(value)!).add(
        normalizeKey(entry.key)
      );
    }

    for (const entry of entries) {
      const key = normalizeKey(entry.key);
      if ((keysByValue.get(entry.value.trim().toLowerCase())?.size ?? 0) > 1) continue;
      // UNIQUE-VALUE GUARD (critical): count how many asserted fields this value matches. A
      // value that matches more than one is NON-DISCRIMINATING — gTLD responses put the same
      // redaction string (`Please contact the RDDS service …`) in registrant/admin/tech/billing
      // email, and the same masked phone across contacts, so matching on it would "learn"
      // `Tech Email → registrantEmail`. An alias is only learnable when the value pins exactly
      // ONE field. This is what keeps the mining honest without a hand-written keyword filter.
      const matched = asserted.filter(([field, value]) => valueMatches(field, entry.value, value));
      if (matched.length !== 1) continue;
      const field = matched[0][0];
      if (onlyField && field !== onlyField) continue;
      // already-claimed key/field pairs are not NEW candidates
      if (mapped.get(key)?.has(field)) continue;
      const byField = evidence.get(key) ?? evidence.set(key, new Map()).get(key)!;
      const ev = byField.get(field) ?? { servers: new Set(), occurrences: 0, examples: [] };
      ev.servers.add(server);
      ev.occurrences++;
      if (ev.examples.length < 3)
        ev.examples.push(`${entry.key.trim()}=${entry.value.trim().slice(0, 40)}`);
      byField.set(field, ev);
    }
  }

  // classify each key: a candidate maps to ONE dominant field (>=80% of its evidence by
  // server breadth); a key spread across fields is ambiguous (review, never auto-fold)
  type Candidate = {
    key: string;
    field: string;
    servers: number;
    occurrences: number;
    likexian: string | null; // what likexian's keyRule maps this key to, if anything
    // true = the key is absent from the current tables entirely → SAFE to fold. false = the
    // key already maps to a DIFFERENT field; folding would make it multi-field, which turns a
    // firmly-mapped key (`e-mail` → registrantEmail) into a coin toss. Those are conflicts to
    // review, never auto-folded.
    keyIsNew: boolean;
    examples: string[];
  };
  const candidates: Candidate[] = [];
  const ambiguous: Array<{ key: string; fields: Record<string, number> }> = [];

  for (const [key, byField] of evidence) {
    const ranked = [...byField.entries()].sort((a, b) => b[1].servers.size - a[1].servers.size);
    const totalServers = new Set([...byField.values()].flatMap(e => [...e.servers])).size;
    const [topField, topEv] = ranked[0];
    const dominant = topEv.servers.size / totalServers >= 0.8;
    if (!dominant && ranked.length > 1) {
      ambiguous.push({
        key,
        fields: Object.fromEntries(ranked.map(([f, e]) => [f, e.servers.size])),
      });
      continue;
    }
    if (topEv.servers.size < minServers) continue;
    candidates.push({
      key,
      field: topField,
      servers: topEv.servers.size,
      occurrences: topEv.occurrences,
      likexian: likexianField(key),
      keyIsNew: !mapped.has(key),
      examples: topEv.examples,
    });
  }
  candidates.sort((a, b) => b.servers - a.servers || b.occurrences - a.occurrences);
  const foldable = candidates.filter(c => c.keyIsNew);
  const conflicts = candidates.filter(c => !c.keyIsNew);

  const pad = (v: string | number, n: number) => String(v).padEnd(n);
  const printRows = (rows: Candidate[]): void => {
    console.log(`${pad('key', 34)}${pad('→ field', 26)}${pad('srv', 5)}${pad('occ', 6)}likexian?`);
    for (const c of rows) {
      const corr = c.likexian === c.field ? '✓' : c.likexian ? `(≠ ${c.likexian})` : '';
      console.log(
        `${pad(c.key, 34)}${pad('→ ' + c.field, 26)}${pad(c.servers, 5)}${pad(c.occurrences, 6)}${corr}`
      );
      if (verbose) console.log(`      e.g. ${c.examples.join(' | ')}`);
    }
  };

  console.log(`\n=== alias mining: ${fixtures} fixtures ===\n`);
  console.log(
    `${foldable.length} FOLDABLE (new key, single field, >=${minServers} servers), ` +
      `${conflicts.length} conflict (key already maps elsewhere), ` +
      `${ambiguous.length} ambiguous (multi-field)\n`
  );
  console.log(`── foldable — safe to add (key is not in any current table) ──`);
  printRows(foldable);
  if (conflicts.length) {
    console.log(`\n── conflicts — key already maps to a DIFFERENT field, review only ──`);
    printRows(conflicts);
  }
  if (ambiguous.length) {
    console.log(`\n── ambiguous — value maps to several fields, review only ──`);
    for (const a of ambiguous.slice(0, 15)) {
      const fields = Object.entries(a.fields)
        .map(([f, n]) => `${f}:${n}`)
        .join(', ');
      console.log(`  ${pad(a.key, 30)} ${fields}`);
    }
  }

  const corroborated = foldable.filter(c => c.likexian === c.field).length;
  console.log(
    `\nprior-art corroboration: ${corroborated}/${foldable.length} foldable candidates match likexian's keyRule`
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      { minedAt: new Date().toISOString(), fixtures, minServers, foldable, conflicts, ambiguous },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log(`\nreport: registry-health/alias-candidates.json`);
  console.log(`elapsed: ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main();
