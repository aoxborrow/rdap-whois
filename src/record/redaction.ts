// redaction: the placeholder text a server writes where it has withheld a value
// ("REDACTED FOR PRIVACY", "Not Disclosed", "Please query the RDDS service of the Registrar of
// Record..."), told apart from real data. lookup() with nullRedacted nulls such values, so a
// redacted field reads as one the server never sent; by default they come back as sent.
//
// The patterns come from the contact values in the WHOIS and RDAP fixture corpus. A known
// privacy service in place of the holder ("Domains By Proxy, LLC", "Privacy service provided
// by Withheld for Privacy ehf") counts as redacted too, but a forwarding address at one is a
// way to reach the holder, so it stays. A value with a URL in it stays too, since the URL is often the only way to contact
// the holder, and so does placeholder text with a real email address in it. An email address
// on its own is a placeholder only when its mailbox says so: redacted@nominet.uk, ***@***.***.
import type { DomainContact, DomainData, DomainRegistrar } from './types';
import { hasDetails } from './utils';

const REDACTED = [
  // the word itself: "REDACTED FOR PRIVACY", "REDACTED_FOR_PRIVACY", "Redacted | EU Data
  // Subject", "GDPR Redacted", "[REDACTED].3054348621", redacted@nominet.uk, Spanish
  // "Redactado", and run together: "REDACTEDFORPRIVACY", "DataRedacted". Not "redaction",
  // and not the end of another word: "unredacted", "UNREDACTED"
  /(?<![a-z])redact(ed|ado)/i,
  /Redact(ed|ado)|(?<![A-Z])REDACT(ED|ADO)/,
  // a value that is only a word for "withheld": "hidden", "Not Disclosed", "<not
  // disclosed>", "[HIDDEN PERSONAL DATA]", "NOT DISCLOSED!", "(not shown)"
  /^[[(<]?\s*(data\s+)?(hidden|private|protected|withheld|restricted|masked|confidential|not\s+disclosed|undisclosed|not\s+published|not\s+shown|not\s+available|non-public)(\s+personal\s+data)?\s*[\])>]?[!.]?$/i,
  /^(not\s+disclosed\s*)+$/i,
  /^data\s+(protected|not\s+disclosed)\b/i,
  /^personal\s+(data|information)\b/i,
  /^statutory\s+masking\b/i,
  /^gdpr\s+masked$/i,
  /not\s+available\s+from\s+(the\s+)?registry/i,
  /can\s*not\s+be\s+publicly\s+disclosed/i,
  // a referral in place of the value: "Please query the RDDS service of the Registrar of
  // Record...", "Please contact the Registrar listed above", "Kindly refer to the RDDS server..."
  /^(please|kindly)\b.*\b(registrar|rdds|whois)\b/i,
  // nothing in place of the value: "N/A", "none", "***", "xxxx"
  /^(n\/a|none|\*{3,}|x{3,})$/i,
];

// the known privacy and proxy services a registrar puts in place of the holder, as the whole
// value: "Domains By Proxy, LLC" says no more about the holder than "REDACTED FOR PRIVACY"
// does. Matched whole, never by word, so "Zomato Media Private Limited", "PROXYTLD SARL" and
// "Private Mail Bag" are kept, and so is a forwarding address at one of these services
const PRIVACY_SERVICES = [
  /^privacy service provided by withheld for privacy (ehf|llc)$/,
  /^withheld for privacy( purposes)?$/,
  /^domains ?by ?proxy,? llc\.?$/,
  /^domainsbyproxy\.com(,.*)?$/,
  /^registration private$/,
  /^super privacy service ltd\.? c\/o dynadot$/,
  /^dynadot privacy service$/,
  /^domain protection services,? inc\.?$/,
  /^(see )?privacyguardian\.org( llc)?$/,
  /^c\/o whoisproxy\.com$/,
  /^privacy protection service - whoisproxy\.ru$/,
  /^po box 99, whoisproxy\.ru$/,
  /^private by design,? llc\.?$/,
  /^privacy protect,? llc( \(privacyprotect\.org\))?$/,
  /^global domain privacy services,? inc\.?$/,
  /^whois privacy corp\.?$/,
  /^digital privacy corporation$/,
  /^identity protection service$/,
  /^whois privacy protection (foundation|service,? inc\.?|service by (onamae\.com|stardomain))$/,
  /^privacy administrator$/,
  /^pts privacy & trustee services gmbh$/,
  /^domain privacy$/,
  /^anonymize,? (inc|llc)\.?$/,
  /^privacy protection$/,
  /^moniker privacy services$/,
  /^whois privacy( service| \(enumdns dba\))?$/,
  /^proxy protection,? llc$/,
  /^web3 privacy llc$/,
  /^perfect privacy,? llc$/,
  /^your whois privacy( ltd)?$/,
  /^super domains privacy llc$/,
  /^contact privacy inc\. customer \d+$/,
  /^hello internet proxy service$/,
];

// a URL, which is kept even inside placeholder text
const URL = /\bhttps?:\/\/|\bwww\./i;

// an email address: its domain names a service, and a mailbox can be called anything
// (private@, confidential@), so only a mailbox that says it is withheld is a placeholder:
// redacted@nominet.uk, undisclosed-email@knipp.de, not active.domains@redacted-for-privacy.name
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// what an address embedded in text is split from: "<redacted@example.com>", "mailto:x@y.z"
const DELIMITERS = /[\s<>()[\]"',;:]+/;
const WITHHELD_MAILBOX =
  /^((redacted|undisclosed|not[._-]?disclosed)|[^@]*[._-]redacted|(\*{3,}|x{3,}|n\/a|none)@)/i;

/**
 * whether a value is a server's placeholder for a value it withheld, or a known privacy
 * service in place of the holder. A value with a URL in it is never one, and neither is other
 * text with a real email address in it.
 */
export function isRedacted(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.trim();
  if (!text || URL.test(text)) return false;
  if (EMAIL.test(text)) return WITHHELD_MAILBOX.test(text);
  const addresses = text.includes('@')
    ? text.split(DELIMITERS).filter(token => EMAIL.test(token))
    : [];
  if (addresses.some(address => !WITHHELD_MAILBOX.test(address))) return false;
  if (REDACTED.some(pattern => pattern.test(text))) return true;
  const name = text.replace(/\s+/g, ' ').toLowerCase();
  return PRIVACY_SERVICES.some(pattern => pattern.test(name));
}

const clean = (value: string | null): string | null => (isRedacted(value) ? null : value);

// a contact without its redacted values, or null when a value was redacted and nothing is left
// but its handle. A contact the server sent with only a handle is left as it is, and a
// registrar's IANA ID is data, never a placeholder, so a registrar with one is kept
function contact<C extends DomainContact | DomainRegistrar>(value: C | null): C | null {
  if (!value) return null;
  const out = { ...value };
  let removed = false;
  for (const [key, field] of Object.entries(value)) {
    let next: unknown = field;
    if (typeof field === 'string') next = clean(field);
    if (Array.isArray(field)) {
      const lines = (field as string[]).filter(line => !isRedacted(line));
      next = lines.length === field.length ? field : lines.length ? lines : null;
    }
    (out as unknown as Record<string, unknown>)[key] = next;
    if (next !== field) removed = true;
  }
  if (!removed) return value;
  return hasDetails(out) ? out : null;
}

// a record with every redacted contact and registrar value made null, as if the server had
// not sent it. A contact left with nothing but its handle is null
export function withoutRedacted<R extends DomainData>(record: R): R {
  return {
    ...record,
    registrar: contact(record.registrar),
    registrant: contact(record.registrant),
    admin: contact(record.admin),
    tech: contact(record.tech),
    billing: contact(record.billing),
  };
}
