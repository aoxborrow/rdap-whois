// Turn what the library returned back into what it was after a trip through JSON, which
// writes a Date as an ISO string and reads it back as that string. The dates are found by
// field name, in the places the library puts them, and never by what a string looks like:
// a registrant named "2024-01-01" stays a string.
import { DATE_FIELDS as WHOIS_DATE_FIELDS } from './whois/date-fields';

// the record's fields that hold dates
const RECORD_DATE_FIELDS = [
  'creationDate',
  'expirationDate',
  'registryExpirationDate',
  'updatedDate',
];

// the discrepancies whose two values are dates
const DATE_DISCREPANCIES = ['creationDate', 'expirationDate'];

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// an ISO string back into a Date. Anything else, including a string that is not a date, is
// left as it is
function toDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function reviveFields(bag: Bag, fields: string[]): Bag {
  const out = { ...bag };
  for (const field of fields) if (field in out) out[field] = toDate(out[field]);
  return out;
}

// a WHOIS hop's parsed data holds dates; an RDAP hop's data is the server's own JSON, which
// has none of the library's, so it stays as it is
function reviveHop(hop: unknown): unknown {
  if (!isBag(hop) || !('queryString' in hop) || !isBag(hop.data)) return hop;
  return { ...hop, data: reviveFields(hop.data, WHOIS_DATE_FIELDS) };
}

function reviveDiscrepancy(discrepancy: unknown): unknown {
  if (!isBag(discrepancy) || !DATE_DISCREPANCIES.includes(discrepancy.field as string)) {
    return discrepancy;
  }
  return reviveFields(discrepancy, ['registry', 'registrar']);
}

function reviveResult(result: Bag): Bag {
  return {
    ...result,
    ...(isBag(result.record) ? { record: reviveFields(result.record, RECORD_DATE_FIELDS) } : {}),
    ...(Array.isArray(result.discrepancies)
      ? { discrepancies: result.discrepancies.map(reviveDiscrepancy) }
      : {}),
    ...(Array.isArray(result.attempts)
      ? {
          attempts: result.attempts.map((attempt: unknown) =>
            isBag(attempt) && Array.isArray(attempt.hops)
              ? { ...attempt, hops: attempt.hops.map(reviveHop) }
              : attempt
          ),
        }
      : {}),
  };
}

/**
 * Give back the Dates in a lookup()'s result (verbose or not), a lookupMany() item, the hops
 * of whois() or rdap() (which is what a cache stores), one hop, or one record, after JSON has
 * made them strings. It returns a copy and leaves what it was given alone. Values that are
 * not a date string stay as they are, so it is safe on an object that still has its Dates
 */
export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reviveHop) as T;
  if (!isBag(value)) return value;
  // a lookupMany() item
  if ('query' in value && isBag(value.result) && !('record' in value)) {
    return { ...value, result: reviveResult(value.result) };
  }
  if ('record' in value && 'source' in value) return reviveResult(value) as T;
  if ('server' in value && 'status' in value) return reviveHop(value) as T;
  // a record: the only shape left that has the record's dates
  if ('available' in value && 'creationDate' in value) {
    return reviveFields(value, RECORD_DATE_FIELDS) as T;
  }
  return value;
}
