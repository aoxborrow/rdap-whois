// Checks on an RDAP domain response before its data is trusted: that it is about the domain
// asked for, and that its dates are believable.
//
// This reports facts and makes no decision: whether a mismatch rejects the response, or a
// bad date is dropped, is the caller's policy. Keeping it a pure function means the same
// checks can be run over any set of responses to see what enforcing them would reject.
import punycode from 'punycode/punycode.js';

// registry dates often carry no time zone, so a date can look up to a day ahead of now,
// or of the expiry, without being wrong
const DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// the parts of an RDAP domain object these checks read (RFC 9083 §5.3)
export interface RdapDomainLike {
  objectClassName?: unknown;
  ldhName?: unknown;
  unicodeName?: unknown;
  events?: unknown;
}

export type RdapNameCheck = 'match' | 'mismatch' | 'missing';

export interface RdapValidation {
  // whether the response names the domain that was asked for
  name: RdapNameCheck;
  // the name the response gave, in ASCII, or null when it gave none
  responseName: string | null;
  // the registration date, or null when it is missing, unparseable, more than a day in the
  // future or more than a day after the expiration date. With more than one distinct date
  // the earliest is kept
  creationDate: Date | null;
}

// lower-case ASCII form of a domain name, without a trailing dot
function asciiName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\.$/, '');
  if (!trimmed) return null;
  try {
    // lower-case before encoding: an upper-case non-ASCII letter is a different code point
    // and encodes to a different xn-- label, which lower-casing afterwards cannot undo
    return punycode.toASCII(trimmed.normalize('NFC').toLowerCase());
  } catch {
    return trimmed.toLowerCase();
  }
}

// the eventDate strings for one action, in the order the server listed them
function eventDates(events: unknown, action: string): string[] {
  if (!Array.isArray(events)) return [];
  const dates: string[] = [];
  for (const event of events as unknown[]) {
    if (typeof event !== 'object' || event === null) continue;
    const { eventAction, eventDate } = event as { eventAction?: unknown; eventDate?: unknown };
    if (eventAction === action && typeof eventDate === 'string') dates.push(eventDate);
  }
  return dates;
}

// an ISO date-time with no offset, which Date.parse would read in the host's time zone. The
// separator can also be a lower-case t or a space
const NO_OFFSET = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(:\d{2}(\.\d+)?)?)$/;

// an RDAP date as a Date, or null when it is missing or not a date
export function parseRdapDate(value: string | undefined): Date | null {
  if (!value) return null;
  // read as UTC, so the same response gives the same date in every runtime
  const local = NO_OFFSET.exec(value.trim());
  const time = Date.parse(local ? `${local[1]}T${local[2]}Z` : value);
  return Number.isFinite(time) ? new Date(time) : null;
}

// check an RDAP domain response against the name that was queried
export function validateRdapDomain(
  response: RdapDomainLike,
  queriedName: string,
  now: Date = new Date()
): RdapValidation {
  const expected = asciiName(queriedName);
  const responseName = asciiName(response.ldhName) ?? asciiName(response.unicodeName);
  const name: RdapNameCheck =
    responseName === null ? 'missing' : responseName === expected ? 'match' : 'mismatch';

  // with more than one registration date, the earliest is the registration
  const valid = eventDates(response.events, 'registration')
    .map(parseRdapDate)
    .filter((date): date is Date => date !== null);
  const earliest = valid.length
    ? valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
    : null;
  const expirationDate = parseRdapDate(eventDates(response.events, 'expiration')[0]);
  const believable =
    earliest !== null &&
    earliest.getTime() <= now.getTime() + DATE_TOLERANCE_MS &&
    !(expirationDate && earliest.getTime() > expirationDate.getTime() + DATE_TOLERANCE_MS);

  return { name, responseName, creationDate: believable ? earliest : null };
}
