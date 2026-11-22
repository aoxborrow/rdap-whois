import {
  ASN_QUERY_TYPE,
  DOMAIN_QUERY_TYPE,
  ENTITY_QUERY_TYPE,
  IP_QUERY_TYPE,
  type QueryType,
} from './common/constants';
import { isTld, isValidDomain, parseIp, toAscii } from './common/utils';

// what kind of thing a query is, when the caller did not say. The order matters: an IP
// address would also pass as a hostname, and an AS number as a handle
export function detectQueryType(query: string): QueryType {
  const text = query.trim();
  if (parseIp(text)) return IP_QUERY_TYPE;
  if (/^(as)?\d{1,10}$/i.test(text)) return ASN_QUERY_TYPE;
  // the same test lookup() makes, so a name under a TLD nobody runs is still a domain
  if (isDomainShaped(text)) return DOMAIN_QUERY_TYPE;
  return ENTITY_QUERY_TYPE;
}

// a query in the form a server expects: an ASCII lower-case name, a canonical IP address,
// an AS number without its prefix
export function normalizeQuery(query: string, queryType: QueryType): string {
  const text = query.trim();
  switch (queryType) {
    case DOMAIN_QUERY_TYPE:
      return toAscii(text).toLowerCase().replace(/\.$/, '');
    case IP_QUERY_TYPE:
      return parseIp(text) ?? text;
    case ASN_QUERY_TYPE:
      return text.replace(/^as/i, '');
    default:
      return text;
  }
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{1,63}$/i;

// whether a query is shaped like a domain name: a known TLD on its own, or dotted labels.
// The TLD does not have to exist; a name under a TLD nobody runs is still a name to ask about
export function isDomainShaped(query: string): boolean {
  const text = toAscii(query.trim()).replace(/\.$/, '');
  if (!text || parseIp(text)) return false;
  return text.includes('.') ? HOSTNAME.test(text) : isTld(text);
}
