// `@aoxborrow/rdap-whois/whois`: the WHOIS parser on its own, and WHOIS's routing. The
// parsed data is parser output: its shape may change in any 0.x release. The client, the
// errors, the cache and the client's option types are exported from the package root
// only.
export {
  parseWhois,
  whoisThrottleLine,
  type ParsedWhois,
  type WhoisCallOptions,
  type WhoisHop,
} from './client';
export { getWhoisServer, getWhoisServerType } from './servers';
// the parser's field tables and value readers, for code that builds a response shape of
// its own from the parsed data, such as one that keeps every field the parser knows. They
// are not part of the stable API: any of them may change or go in any release
export {
  ARRAY_FIELDS as WHOIS_ARRAY_FIELDS,
  DATE_FIELDS as WHOIS_DATE_FIELDS,
  PARSED_FIELDS as WHOIS_FIELDS,
} from './base';
export { parseDate as parseWhoisDate } from './dates';
export type { ParserOptions as WhoisParserOptions } from './data-types';
export { parseWhoisDnssecValue } from './utils';
// each protocol's data made into the normalized record, one server's answer at a time, as
// lookup() does before it combines the answers
export {
  transformRdapDomainData,
  transformWhoisDomainData,
  type RdapRecordSource,
  type WhoisRecordSource,
} from '../record/transforms';
export type {
  WhoisAsnData,
  WhoisDataType,
  WhoisDomainData,
  WhoisEntityData,
  WhoisIpData,
  WhoisQueryType,
  WhoisServerType,
} from './data-types';
