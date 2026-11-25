// The normalized oracle shape + comparison semantics (docs/registry-health.md O1/O2).
// Every oracle — whoiser in-process, the Go/Ruby CLI wrappers, the RDAP voice — reduces
// its native output to this one shape, so the compare harness only ever sees normalized
// results. The wrapper-side contract (CLI flags, batch protocol, per-field rules) is
// documented for non-TS wrappers in ./schema.md; this file is the TS statement of it.
import { datesEquivalent } from '../compare';

// the comparable field set: the intersection of what our engine and at least one oracle
// can extract. Deliberately smaller than PARSED_FIELDS — address/meta fields are noisy
// and low-value (same rule as compare.ts's skipField).
export const ORACLE_FIELDS = [
  'domain_id',
  'domain_name',
  'registrar_id',
  'registrar_name',
  'registrar_url',
  'registrar_whois_server',
  'registrar_abuse_email',
  'registrar_abuse_phone',
  'creation_date',
  'updated_date',
  'expiration_date',
  'dnssec',
  'status',
  'nameservers',
  'registrant_name',
  'registrant_org',
  'registrant_email',
  'registrant_country',
  'admin_name',
  'admin_email',
  'tech_name',
  'tech_email',
] as const;

export type OracleFieldName = (typeof ORACLE_FIELDS)[number];

export type OracleFields = Partial<{
  [K in OracleFieldName]: K extends 'status' | 'nameservers' ? string[] : string | null;
}>;

export type OracleResult = {
  notFound: boolean;
  reserved: boolean;
  fields: OracleFields;
};

// per-field normalization kind
const FIELD_KIND: Record<OracleFieldName, 'string' | 'date' | 'status' | 'ns' | 'url' | 'id'> = {
  domain_id: 'id',
  domain_name: 'string',
  registrar_id: 'id',
  registrar_name: 'string',
  registrar_url: 'url',
  registrar_whois_server: 'url',
  registrar_abuse_email: 'string',
  registrar_abuse_phone: 'string',
  creation_date: 'date',
  updated_date: 'date',
  expiration_date: 'date',
  dnssec: 'string',
  status: 'status',
  nameservers: 'ns',
  registrant_name: 'string',
  registrant_org: 'string',
  registrant_email: 'string',
  registrant_country: 'string',
  admin_name: 'string',
  admin_email: 'string',
  tech_name: 'string',
  tech_email: 'string',
};

// exact-match (lowercased) placeholder values treated as ABSENT on both sides — a
// redaction is not a value, and an oracle that drops it while we keep it (or vice versa)
// is not a divergence. Conservative: privacy-SERVICE names (whoisguard etc.) are real
// registrant values and stay.
const REDACTION_MARKERS = new Set([
  '-',
  '.',
  'n/a',
  'na',
  'none',
  'no data',
  'not available',
  'not disclosed',
  'data protected',
  'data redacted',
  'redacted',
  'redacted for privacy',
  'redacted for gdpr',
  'gdpr redacted',
  'gdpr masked',
  'non-public data',
  'statutory masking enabled',
  'redacted | eu registrar',
  'redacted | eu data subject',
  'redacted | registry policy',
  'registration private',
  'privado',
  'unknown',
  'null',
  '<data not disclosed>',
  'not.defined',
]);

const clean = (value: string): string => value.trim().replace(/\s+/g, ' ');

function normalizeScalar(kind: (typeof FIELD_KIND)[OracleFieldName], value: string): string {
  switch (kind) {
    case 'date':
      // near-verbatim — dates compare through datesEquivalent, not equality; fractional
      // seconds are stripped because parseFixtureDateString can't read them. A year-0 or
      // year-1 date is a placeholder some registrars print for no date (Namecheap's
      // `Updated Date: 0001-01-01T00:00:00.00Z`), so it counts as no value
      if (/^\s*000[01]-/.test(value)) return '';
      return value.trim().replace(/(\.\d+)(?=Z$|[+-]\d)/, '');
    case 'url':
      return clean(value)
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/\/+$/, '');
    case 'id':
      return clean(value).replace(/^0+(?=\d)/, '');
    case 'status':
      // "clientdeleteprohibited https://icann.org/epp#..." → first token, no parenthetical
      return clean(value).toLowerCase().split(/[\s(]/)[0].replace(/,+$/, '');
    case 'ns':
      // lowercase host only (some registries append IPs), no trailing dot
      return clean(value).toLowerCase().split(/\s/)[0].replace(/\.+$/, '');
    default:
      return clean(value).toLowerCase();
  }
}

// normalize one side's value for a field: null when absent/redacted; sorted de-duped
// arrays for the array fields
export function normalizeValue(field: OracleFieldName, value: unknown): string | string[] | null {
  const kind = FIELD_KIND[field];
  if (field === 'status' || field === 'nameservers') {
    const items = (Array.isArray(value) ? value : value == null ? [] : [value])
      .map(v => normalizeScalar(kind, String(v)))
      .filter(v => v && !REDACTION_MARKERS.has(v));
    return items.length ? [...new Set(items)].sort() : null;
  }
  if (value == null || Array.isArray(value)) return null;
  const normalized = normalizeScalar(kind, String(value));
  if (!normalized || REDACTION_MARKERS.has(normalized.toLowerCase())) return null;
  return normalized;
}

// do two NORMALIZED values denote the same thing?
export function normalizedMatch(
  field: OracleFieldName,
  a: string | string[] | null,
  b: string | string[] | null
): boolean {
  if (a == null || b == null) return a === b;
  if (FIELD_KIND[field] === 'date') return datesEquivalent(a, b);
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  // domain_name: some oracles join IDN variants into one value — containment as a token
  // (either direction) is agreement, not divergence
  if (field === 'domain_name' && typeof a === 'string' && typeof b === 'string') {
    return a.split(' ').includes(b) || b.split(' ').includes(a);
  }
  return false;
}
