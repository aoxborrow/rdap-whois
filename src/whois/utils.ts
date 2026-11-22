import { isEmpty } from '../common/values';
import type { WhoisValue } from './data-types';

// clean an array of values, removing empties and duplicates, converting values to string
export function cleanArray(array: string[]): string[] {
  // handle non-array input or empty values
  if (isEmpty(array)) return [];

  // if not an array, convert to array
  const input = Array.isArray(array) ? array : [array];

  // convert all values to string, filter out empty values, and remove duplicates
  return input
    .map(v => (v === null ? null : String(v)))
    .filter((v): v is string => typeof v === 'string' && !isEmpty(v))
    .filter(
      (item, index, self) => index === self.findIndex(v => v.toLowerCase() === item.toLowerCase())
    );
}

// clean a nameserver string by removing IPs, brackets, and other non-hostname content
export function cleanNameserver(nameserver: string | null | undefined): string | null {
  if (isEmpty(nameserver)) return null;

  return String(nameserver)
    .replace(/\s*\[[^\]]*\]/g, '') // remove bracketed IPs
    .replace(/\s*\([^)]*\)/g, '') // remove parenthesized IPs
    .replace(/\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '') // remove IPv4
    .replace(/\s+[0-9a-fA-F:]+:[0-9a-fA-F:]+/g, '') // remove IPv6
    .replace(/\s*:\s*\d+$/g, '') // remove port numbers if present
    .replace(/\.*\s*$/, '') // remove trailing dots
    .replace(/^[-•>*\s]+/, '') // remove leading dashes and other prefixes
    .toLowerCase()
    .trim();
}

// clean a status string by removing URLs and any parentheses
// don't lowercase the status!
export function cleanStatus(status: string | null | undefined): string | null {
  if (isEmpty(status)) return null;

  const raw = String(status).trim();
  // Some registries print the status as a bare EPP link whose fragment (or last path segment)
  // IS the code: `http://www.icann.org/epp#clientTransferProhibited` → `clientTransferProhibited`
  // (whois.apiname.com). The old per-server parsers captured that fragment with a regex; the
  // block engine takes the whole value, so normalize it here.
  const eppUrl = raw.match(/^https?:\/\/\S*?epp\S*?[#/](\w+)\s*$/i);
  if (eppUrl) return eppUrl[1];

  return (
    raw
      .replace(/\s*\(https?:\/\/.*?\)/gi, '') // remove URLs in parentheses (case insensitive)
      // trailing ` - <description or url>`: an EPP status code is a single word, so anything after
      // a ` - ` (or ` -- `) separator is the registry's gloss (`ok - Normal state.`, whois.nic.kz)
      // or the epp link (`clientTransferProhibited -- http://…`, whois.pananames.com) — drop it,
      // and the dangling separator, rather than leaving `clientTransferProhibited --`.
      .replace(/\s+[-–]+\s.*$/, '')
      .replace(/\s+https?:\/\/.*?$/gi, '') // remove URLs after space (case insensitive)
      .replace(/\s*#.*?$/g, '') // remove hash fragments
      .replace(/\s+[-–]+\s*$/, '') // remove a dangling separator left after a url/gloss strip
      .trim()
  );
}

// registries write the same code with different separators (`client_delete_prohibited` at
// whois.register.si), so match on a key with `_` and `-` removed. spaces are deliberately NOT
// collapsed: the unqualified `update prohibited` entries below are a guess about client-vs-server,
// and folding `UpdateProhibited` (whois.rotld.ro) into them would spread that guess further
// NFC so an accented value matches whichever way the registry encoded it: whois.nic.tg sends
// `Activé` precomposed (U+00E9), but the decomposed `e` + U+0301 spelling looks identical and
// would otherwise miss the map entry
const normalizeStatusKey = (status: string) =>
  status.normalize('NFC').toLowerCase().replace(/[_-]/g, '');

// get the EPP status from the whois status string
export const whoisGetEppStatus = (status: string): string | null => {
  const normalized = normalizeStatusKey(status);
  // find the matching key in the map (case insensitive, separator insensitive)
  const matchingKey = Object.keys(WHOIS_EPP_STATUS_MAP).find(
    key => normalizeStatusKey(key) === normalized
  );
  return matchingKey ? WHOIS_EPP_STATUS_MAP[matchingKey] : null;
};

// mapping of whois status values to EPP status codes for linking
export const WHOIS_EPP_STATUS_MAP: Record<string, string> = {
  // Standard EPP status codes (case insensitive)
  'ok': 'ok',
  'addperiod': 'addPeriod',
  'linked': 'linked',
  'autorenewperiod': 'autoRenewPeriod',
  'clientdeleteprohibited': 'clientDeleteProhibited',
  'clienthold': 'clientHold',
  'clientrenewprohibited': 'clientRenewProhibited',
  'clienttransferprohibited': 'clientTransferProhibited',
  'clientupdateprohibited': 'clientUpdateProhibited',
  'inactive': 'inactive',
  'pendingcreate': 'pendingCreate',
  'pendingdelete': 'pendingDelete',
  'pendingrenew': 'pendingRenew',
  'pendingrestore': 'pendingRestore',
  'pendingtransfer': 'pendingTransfer',
  'pendingupdate': 'pendingUpdate',
  'redemptionperiod': 'redemptionPeriod',
  'renewperiod': 'renewPeriod',
  'serverdeleteprohibited': 'serverDeleteProhibited',
  'serverhold': 'serverHold',
  'serverrenewprohibited': 'serverRenewProhibited',
  'servertransferprohibited': 'serverTransferProhibited',
  'serverupdateprohibited': 'serverUpdateProhibited',
  'transferperiod': 'transferPeriod',

  // Alternative formats and variations found in whois data
  'active': 'ok',
  // French for the `active` above — whois.nic.sn writes `actif`, whois.nic.tg writes `Activé`.
  // a translation of an existing entry, not a new claim about what the registry meant
  'actif': 'ok',
  'activé': 'ok',
  'client delete prohibited': 'clientDeleteProhibited',
  'client transfer prohibited': 'clientTransferProhibited',
  'client update prohibited': 'clientUpdateProhibited',
  'client renew prohibited': 'clientRenewProhibited',
  'server delete prohibited': 'serverDeleteProhibited',
  'server transfer prohibited': 'serverTransferProhibited',
  'server update prohibited': 'serverUpdateProhibited',
  'server renew prohibited': 'serverRenewProhibited',
  // these four unqualified forms guess `client*`, and in the recorded responses NONE of them
  // ever fires — every prohibition that maps is explicitly qualified, either `client X` or
  // `X by Registrar`/`by Registry`. so the guess is currently inert, which is the reason not to
  // add synonyms (`Transfer Locked`, `Deletion forbidden`, `UpdateProhibited`) that would
  // activate it. re-check against the fixtures before relying on that
  'delete prohibited': 'clientDeleteProhibited',
  'transfer prohibited': 'clientTransferProhibited',
  'update prohibited': 'clientUpdateProhibited',
  'renew prohibited': 'clientRenewProhibited',

  // `by Registry` / `by Registrar` is the qualifier the unqualified forms above are missing:
  // EPP's client* codes are the ones the registrar sets and can lift, server* are the registry's.
  // whois.je, whois.gg and whois.nic.as spell it out this way, so these are not guesses
  'delete prohibited by registry': 'serverDeleteProhibited',
  'renew prohibited by registry': 'serverRenewProhibited',
  'transfer prohibited by registry': 'serverTransferProhibited',
  'update prohibited by registry': 'serverUpdateProhibited',
  'delete prohibited by registrar': 'clientDeleteProhibited',
  'renew prohibited by registrar': 'clientRenewProhibited',
  'transfer prohibited by registrar': 'clientTransferProhibited',
  'update prohibited by registrar': 'clientUpdateProhibited',

  // Additional status mappings that point to EPP equivalents
  'add period': 'addPeriod',
  'auto renew period': 'autoRenewPeriod',
  'pending create': 'pendingCreate',
  'pending delete': 'pendingDelete',
  'pending renew': 'pendingRenew',
  'pending restore': 'pendingRestore',
  'pending transfer': 'pendingTransfer',
  'pending update': 'pendingUpdate',
  'redemption period': 'redemptionPeriod',
  'renew period': 'renewPeriod',
  'transfer period': 'transferPeriod',
};

// a WHOIS DNSSEC value as a yes or no, or null when the text says neither
export function parseWhoisDnssecValue(dnssec: string | boolean | null | undefined): boolean | null {
  if (typeof dnssec === 'boolean') return dnssec;
  if (isEmpty(dnssec)) return null;

  // `Unsigned Delegation` reads as `unsigneddelegation`
  const value = String(dnssec).toLowerCase().replace(/\s+/g, '');

  // common positive values
  if (['yes', 'signed', 'active', 'enabled', '1', 'true', 'signeddelegation'].includes(value)) {
    return true;
  }

  // common negative values
  if (
    ['no', 'unsigned', 'inactive', 'disabled', '0', 'false', 'unsigneddelegation'].includes(value)
  ) {
    return false;
  }

  // anything else doesn't map cleanly; the parsed data keeps the text as dnssecRaw
  return null;
}

// get the first value from an array, convert to string and trim
export function singleValue(value: WhoisValue, lowercase = false): string | null {
  // if the value is an array, use the first value
  const singleValue = Array.isArray(value) ? value[0] : value;
  // one more check to make sure it's not an array of arrays
  const reallySingleValue = Array.isArray(singleValue)
    ? (singleValue as unknown[])[0]
    : singleValue;
  if (isEmpty(reallySingleValue)) return null;
  return lowercase
    ? String(reallySingleValue).toLowerCase().trim()
    : String(reallySingleValue).trim();
}
