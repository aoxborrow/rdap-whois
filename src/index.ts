// `@aoxborrow/rdap-whois`: the client, lookup(), whois() and rdap() on a shared default
// client, RDAP's routing, the errors, the cache, and every type a caller of them needs. The
// WHOIS parser is not part of this entry's static imports: RdapWhois loads it the first time
// a call needs WHOIS.
export { lookup, rdap, RdapWhois, whois } from './client';
export type {
  LookupAttempt,
  LookupManyItem,
  LookupOptions,
  LookupResult,
  LookupSourceInfo,
  VerboseLookupOptions,
  VerboseLookupResult,
} from './client';
export { registrableDomain } from './registrable';
export { memoryCache, type MemoryCacheOptions } from './cache';
export { reviveDates } from './revive';
export type {
  CacheKey,
  CachedHops,
  CallOptions,
  ClientEvent,
  FallbackEvent,
  HopCache,
  HopStatus,
  RdapWhoisOptions,
  RedirectEvent,
  ReferralEvent,
  RequestEvent,
  RetryEvent,
  TransformErrorEvent,
} from './core';
export {
  ConnectionError,
  EmptyResponseError,
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  NoUsableAnswerError,
  ProxyError,
  RateLimitError,
  RdapWhoisError,
  ServerError,
  TimeoutError,
} from './errors';
export type { ErrorInfo, Protocol, RdapWhoisErrorName } from './errors';
export { DATA_VERSION, type DataVersion } from './data-version';
export type { QueryType, ServerType } from './common/constants';
export type {
  Connect,
  Connection,
  ConnectOptions,
  ConnectTarget,
  ProxyOption,
  ProxySpec,
} from './net/types';
export { KNOWN_SERVER_LIMITS, type ServerLimit } from './net/limiter';
export type { RdapCallOptions, RdapHop } from './rdap/client';
export {
  getRdapEntityTags,
  getRdapServer,
  getServerType as getRdapServerType,
} from './rdap/servers';
export { getRdapQueryPath, normalizeRdapServer } from './rdap/utils';
export type { FetchLike } from './rdap/request';
export type { RdapQueryType, RdapResponse, RdapServerType } from './rdap/types';
export type { Discrepancy, DomainRecord, RecordGroup, RecordProvenance } from './record/record';
export type { CountryCode } from './record/countries';
export type {
  DomainContact,
  DomainContactType,
  DomainData,
  DomainRegistrar,
  EppStatus,
} from './record/types';
export type { WhoisCallOptions, WhoisHop } from './whois/client';
export type { WhoisDataType, WhoisDomainData, WhoisServerType } from './whois/data-types';
