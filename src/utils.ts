// `@aoxborrow/rdap-whois/utils`: types and helpers for reading registration data, with no
// network code, so it is safe in a browser bundle. The normalized record and its values
// (EPP statuses, countries), RDAP response types with guards and finders, vCards, and WHOIS
// status values.

// the normalized record
export { DOMAIN_CONTACT_TYPES } from './record/constants';
export type { DomainContact, DomainContactType, DomainData, DomainRegistrar } from './record/types';
export type { Discrepancy, DomainRecord } from './record/record';
// the placeholder text a server writes for a value it withheld
export { isRedacted } from './record/redaction';
// Dates back from what JSON made of a result
export { reviveDates } from './revive';
export { EPP_STATUS_VALUES, isEppStatus, type EppStatus } from './record/epp';
export {
  COUNTRY_CODES,
  getCountryName,
  isValidCountryCode,
  parseCountryCode,
  type CountryCode,
} from './record/countries';
export type { QueryType, ServerType } from './common/constants';

// RDAP responses
export { RDAP_ENTITY_ROLES, RDAP_QUERY_TYPES, RDAP_REGIONAL_REGISTRIES } from './rdap/constants';
export {
  findEntitiesByRole,
  findEventByAction,
  findLinkByRel,
  gatherEntitiesByRole,
  isAsnResponse,
  isCommonResponse,
  isDomainResponse,
  isEntityResponse,
  isErrorResponse,
  isIpResponse,
  isNameserverResponse,
  isObjectResponse,
  isRdapResponse,
  rdapGetEppStatus,
} from './rdap/utils';
export { parseToVcardSimple } from './rdap/vcard';
export type {
  RdapAsnResponse,
  RdapAutNumObject,
  RdapBaseObject,
  RdapCommonResponse,
  RdapDomainObject,
  RdapDomainResponse,
  RdapDomainSearchResponse,
  RdapDsData,
  RdapEntityObject,
  RdapEntityResponse,
  RdapEntityRole,
  RdapEntitySearchResponse,
  RdapErrorResponse,
  RdapEvent,
  RdapHelpResponse,
  RdapIPNetworkObject,
  RdapIpResponse,
  RdapKeyData,
  RdapLink,
  RdapNameserverObject,
  RdapNameserverResponse,
  RdapNameserverSearchResponse,
  RdapNotice,
  RdapNoticeAndRemarkTypes,
  RdapObjectClass,
  RdapObjectResponse,
  RdapPublicID,
  RdapQueryType,
  RdapRemark,
  RdapResponse,
  RdapSecureDNS,
  RdapServerType,
  RdapStatus,
  RdapVcardSimple,
} from './rdap/types';

// WHOIS values
export { WHOIS_REGIONAL_REGISTRIES } from './whois/constants';
export { cleanNameserver, cleanStatus, whoisGetEppStatus } from './whois/utils';
