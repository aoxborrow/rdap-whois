# Exports

Every export of each entry point, as of 0.1, kept by hand from the entry files
(`src/index.ts`, `src/whois/index.ts`, `src/utils.ts`, `src/transports/node.ts`): a change to
one of them changes this page too. The README explains how they fit together; the type
declarations say what each takes and returns.

## `@aoxborrow/rdap-whois`

- `lookup(query, options?)`, `whois(query, options?)`, `rdap(query, options?)`: on one
  default client, shared by the program
- `RdapWhois`, with `lookup()`, `whois()`, `rdap()`, `lookupMany()` and `lookupAll()`
- `registrableDomain(name)`: the name a registry holds, or null for a suffix
- `KNOWN_SERVER_LIMITS`: the limits registries publish, by hostname
- `DATA_VERSION`: the dates of the routing data and limits built into this release
- `getRdapServer(queryType, query)`: the server a query goes to, or null
- `getRdapServerType(queryType, query, server)`, `getRdapEntityTags()` (each handle tag
  with its server), `getRdapQueryPath(queryType, query)`, `normalizeRdapServer(url)`
- `memoryCache(options?)`, `reviveDates(value)`
- errors: `RdapWhoisError`, `InvalidQueryError`, `NoUsableAnswerError`, `TimeoutError`,
  `RateLimitError`, `NoServerError`, `ProxyError`, `EmptyResponseError`,
  `InvalidResponseError`, `ServerError`, `ConnectionError`
- types for options and calls (`LookupOptions` adds `protocol`, `verbose` and
  `nullRedacted`): `RdapWhoisOptions`, `CallOptions`, `LookupOptions`,
  `VerboseLookupOptions`,
  `WhoisCallOptions`, `RdapCallOptions`, `QueryType`, `RdapQueryType`, `Protocol`
- types for results: `LookupResult`, `VerboseLookupResult`, `LookupAttempt`, `LookupSourceInfo`, `LookupManyItem`,
  `WhoisHop`, `RdapHop`, `HopStatus`, `ServerType`, `WhoisServerType`, `RdapServerType`,
  `RdapResponse`, `WhoisDataType`, `WhoisDomainData`,
  `ErrorInfo`, `RdapWhoisErrorName`, `DataVersion`
- types for the record: `DomainRecord`, `DomainData`, `DomainContact`, `DomainContactType`,
  `DomainRegistrar`, `Discrepancy`, `RecordGroup`, `RecordProvenance`, `EppStatus`,
  `CountryCode`
- types for events: `ClientEvent`, `RequestEvent`, `RetryEvent`, `ReferralEvent`,
  `RedirectEvent`, `FallbackEvent`, `TransformErrorEvent`
- types for the cache: `HopCache`, `CacheKey`, `CachedHops`, `MemoryCacheOptions`
- types for the network: `Connect`, `Connection`, `ConnectOptions`, `ConnectTarget`,
  `FetchLike`, `ProxyOption`, `ProxySpec`, `ServerLimit`, `TargetPolicy`, `PolicyTarget`

## `@aoxborrow/rdap-whois/whois`

- `parseWhois(raw, server, queryType?)`, `whoisThrottleLine(raw, server)`
- `getWhoisServer(queryType, query)`: the server a query goes to; `getWhoisServerType(host)`
- the types `ParsedWhois`, `WhoisHop`, `WhoisCallOptions`, `WhoisDataType`,
  `WhoisDomainData`, `WhoisIpData`, `WhoisAsnData`, `WhoisEntityData`, `WhoisQueryType`,
  `WhoisServerType`
- not stable, and may change or go in any release:
  - `WHOIS_FIELDS`, `WHOIS_DATE_FIELDS`, `WHOIS_ARRAY_FIELDS`: the parsed data's fields, and
    which hold dates or lists
  - `parseWhoisDate(text, options?)`, `parseWhoisDnssecValue(text)`: a date or a DNSSEC
    value as WHOIS servers write them; `WhoisParserOptions` is the type of `options`
  - `transformRdapDomainData()`, `transformWhoisDomainData()`, with the types
    `RdapRecordSource` and `WhoisRecordSource`: one server's answer made into a record, as
    `lookup()` does before it combines the answers

The client, the errors, the cache, `reviveDates()` and the client's option types are not
exported here: import them from the package root.

## `@aoxborrow/rdap-whois/utils`

No network code, so it is safe in a browser bundle. It is built as one file of its own, so
importing a constant from it costs about that constant.

- the record: `DOMAIN_CONTACT_TYPES`, `EPP_STATUS_VALUES`, `isEppStatus()`, `isRedacted()`, and the types
  `DomainRecord`, `DomainData`, `DomainContact`, `DomainContactType`, `DomainRegistrar`,
  `Discrepancy`, `EppStatus`, `QueryType`, `ServerType`
- `reviveDates(value)`: a result's dates back from what JSON made of them
- countries: `COUNTRY_CODES`, `getCountryName()`, `isValidCountryCode()`,
  `parseCountryCode()`, `CountryCode`
- RDAP responses: `isRdapResponse()`, `isErrorResponse()`, `isCommonResponse()`,
  `isObjectResponse()`, `isDomainResponse()`, `isIpResponse()`, `isAsnResponse()`,
  `isEntityResponse()`, `isNameserverResponse()`, `findEntitiesByRole()`,
  `gatherEntitiesByRole()`, `findEventByAction()`, `findLinkByRel()`, `rdapGetEppStatus()`,
  `parseToVcardSimple()`, `RDAP_ENTITY_ROLES`, `RDAP_QUERY_TYPES`,
  `RDAP_REGIONAL_REGISTRIES` (a registry's name to its server), and the RDAP response and
  object types (`RdapResponse`, `RdapDomainResponse`, `RdapEntityObject`, `RdapEvent`,
  `RdapLink`, `RdapVcardSimple` and the rest)
- WHOIS values: `cleanStatus()`, `cleanNameserver()`, `whoisGetEppStatus()`,
  `WHOIS_REGIONAL_REGISTRIES` (a registry's name to its server)

## `@aoxborrow/rdap-whois/transports/node`

- `connect`, `createConnect(options)`, `NodeTransportOptions`
