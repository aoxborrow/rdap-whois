// How a parsed WHOIS record is compared with a golden one: which fields count, and the
// tolerances for dates and empty values. The golden test, the parser regression report
// (check-parsers.ts), the golden regenerator and the corpus tooling all use it, so every
// harness agrees on what "matches the golden" means, down to the date tolerance and the
// empty-vs-null rules.
import { readFileSync, existsSync } from 'node:fs';
import {
  ADDRESS_FIELDS,
  ARRAY_FIELDS,
  DATE_FIELDS,
  DOMAIN_REQUIRED_FIELDS,
} from '../../src/whois/base';
import { isDateString, toDateString } from '../../src/whois/dates';

export const isArrayField = (key: string): boolean => ARRAY_FIELDS.includes(key);
export const isAddressField = (key: string): boolean => ADDRESS_FIELDS.includes(key);
export const isDateField = (key: string): boolean => DATE_FIELDS.includes(key);

// a date as the corpus writes it, which is ISO with no milliseconds or timezone offset
export function parseFixtureDateString(input: string): Date {
  if (!isDateString(input)) {
    throw new Error(`Invalid fixture date format: ${input}`);
  }
  return new Date(input);
}

// address fields are noisy and low-value (the old test skipped them by default); keep the
// reports focused on the fields the API actually surfaces
export const skipField = (key: string): boolean =>
  isAddressField(key) || key === 'query' || key === 'server';

// a date value as text. Dates in the corpus are strings; anything else is compared by its JSON
function dateText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return toDateString(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// dates match if they denote the same instant to the minute (tz/format tolerant)
export function datesEquivalent(a: unknown, b: unknown): boolean {
  const as = dateText(a);
  const bs = dateText(b);
  if (!as || !bs) return as === bs;
  if (as.startsWith('[') || bs.startsWith('[')) return as === bs;
  try {
    const da = parseFixtureDateString(as);
    const db = parseFixtureDateString(bs);
    return (
      da.getUTCFullYear() === db.getUTCFullYear() &&
      da.getUTCMonth() === db.getUTCMonth() &&
      da.getUTCDate() === db.getUTCDate() &&
      da.getUTCHours() === db.getUTCHours() &&
      da.getUTCMinutes() === db.getUTCMinutes()
    );
  } catch {
    return as === bs;
  }
}

export function arraysEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isEmpty(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

// parsed data in the form a golden file stores it: dates as text, in the corpus's format
export function goldenData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Date ? toDateString(value) : value;
  }
  return out;
}

// does a parsed value match the golden for this field, under the corpus's tolerances?
export function fieldMatches(field: string, expected: unknown, result: unknown): boolean {
  if (isEmpty(expected) && isEmpty(result)) return true;
  if (isDateField(field)) return datesEquivalent(result, expected);
  if (isArrayField(field)) return arraysEqual(result ?? [], expected ?? []);
  return (result ?? null) === (expected ?? null);
}

// Structural plausibility of a NEW-engine value, judged by the shape of the value alone. The
// golden scoreboard only judges fields the golden asserts (assertedFields) — so a value the new
// engine ADDS to a field the golden never had is invisible to it, and a mis-mapped value sails
// through as a "lift" (the .it registrantName="Pisa" class, §6ag). This catches the ONE mis-map
// a value's own shape gives away with near-certainty: a non-date sitting in a date field.
//
// Value-shape is a BLUNT tool and most "wrong-looking" values are legit registry quirks — an
// abuse WEB-FORM URL in registrarAbuseEmail (PANDI/.id, handled downstream) or a `[PRIVEE]` /
// `REDACTED` placeholder in a phone field are NOT mis-maps, and flagging them makes the gate cry
// wolf. So email-shape and phone-shape checks were deliberately dropped (§6ag2). Dates are the
// exception: a date field is machine-typed downstream, so a value parseFixtureDateString can't
// read there is a genuine mis-map, not a quirk. The subtler class — a plausible-looking value in
// the WRONG field (a city in *_name) — needs cross-field context and is caught separately by the
// harness's fold differential. The real backstop is corpus COVERAGE: once a golden asserts a
// field, a wrong value there is a visible loss, not an invisible lift. Returns reason slugs.
export function suspectReasons(field: string, value: unknown): string[] {
  if (isEmpty(value) || Array.isArray(value)) return [];
  // the parser gives dates as Date values: only an invalid one is a non-date
  if (value instanceof Date) {
    return isDateField(field) && Number.isNaN(value.getTime()) ? ['unparseable-date'] : [];
  }
  const sval = String(value).trim();
  if (!sval) return [];
  const reasons: string[] = [];

  // a date field whose value is not a parseable date (a non-date mis-mapped in). `[...]`
  // bracketed placeholders (redactions) are a legit non-date and skipped.
  if (isDateField(field) && !sval.startsWith('[')) {
    try {
      parseFixtureDateString(sval);
    } catch {
      reasons.push('unparseable-date');
    }
  }

  return reasons;
}

// the fields a fixture is judged on: every required field + every field the golden
// asserts a value for
export function assertedFields(golden: Record<string, unknown>): string[] {
  const fields = new Set([...DOMAIN_REQUIRED_FIELDS, ...Object.keys(golden)]);
  return [...fields].filter(field => {
    if (skipField(field)) return false;
    // only assert on required fields or fields the golden gives a value
    return DOMAIN_REQUIRED_FIELDS.includes(field) || !isEmpty(golden[field]);
  });
}

// a golden as loaded for comparison: required fields default to null, since the golden
// format omits absent required fields
export function withRequiredFields(raw: Record<string, unknown>): Record<string, unknown> {
  const golden: Record<string, unknown> = {};
  for (const field of DOMAIN_REQUIRED_FIELDS) golden[field] = null;
  Object.assign(golden, raw);
  return golden;
}

// golden values, treating any non-required key present in the json as expected
export function loadGolden(
  foundDir: string,
  server: string,
  query: string
): Record<string, unknown> | null {
  const jsonPath = `${foundDir}${server}___${query}.json`;
  if (!existsSync(jsonPath)) return null;
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
  return withRequiredFields(raw);
}
