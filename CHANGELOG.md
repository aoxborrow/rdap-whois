# Changelog

All notable changes to `@aoxborrow/rdap-whois`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semver](https://semver.org/), with breaking changes in 0.x minor releases.

Routing data (which server answers for which TLD) changes in patch releases, listed under
**Routing data** with the zones that changed.

## [Unreleased]

## [0.1.0] - 2026-11-22

First release.

### Added

- `lookup()`: RDAP first and WHOIS as the fallback, the registry's referral to the
  registrar followed, and one normalized `DomainRecord` with the `source` it rests on.
  `verbose: true` adds every server's answer in `attempts`, `provenance` (which side each
  part came from) and `discrepancies`.
- `whois()` and `rdap()`: one protocol, every server's answer raw and parsed, for domains,
  IP addresses, AS numbers and entity handles.
- `lookup()`, `whois()` and `rdap()` as top-level functions on one default client shared
  by the program, its limits included, and the `RdapWhois` client with the same methods
  plus `lookupMany()` and `lookupAll()`.
- `registrableDomain()`, which `lookup()` uses to look a host up as the name a registry
  holds.
- `parseWhois()` and `whoisThrottleLine()` for a response you already have
  (`@aoxborrow/rdap-whois/whois`).
- Per-server rate limits, with the limits registries publish (`KNOWN_SERVER_LIMITS`);
  retries with backoff, `Retry-After`, and `totalTimeout` per call.
- SOCKS5 and HTTP CONNECT proxies for both protocols, and a target policy for the hosts
  referrals and redirects lead to. Every address a server's name resolves to must be
  public, and the connection, direct or through a proxy, goes to those addresses and never
  to the name; a refusal is a `BlockedTargetError`, never retried. The `resolve` option
  replaces the resolver, and gives Workers one.
- `memoryCache()`, the `HopCache` interface, and `reviveDates()`.
- `DATA_VERSION`: the dates of the RDAP bootstrap, the WHOIS table and the published limits
  built into the release.
- Node.js 22.12+ and Cloudflare Workers transports, with no `nodejs_compat` flag on Workers.
- `@aoxborrow/rdap-whois/utils`: the record's types, EPP statuses, countries, RDAP response
  guards and finders, with no network code.
- The `rdap-whois` command, with `-h`, `--version`, and the proxy from `RDAP_WHOIS_PROXY`.

### Changed before release

For code that used the package from source before 0.1.0, such as DNS.Tools.

- Breaking: the package is ES modules only and needs Node 22.12 or later. `require()` still
  works through Node's require(esm). The tarball no longer ships `src` or `data`.
- Breaking: the `Rdap` and `Whois` classes are removed. Use `RdapWhois#rdap()` and
  `RdapWhois#whois()`, or the top-level `rdap()` and `whois()`.
- Breaking: `hop.attempts`, `error.attempts`, `ErrorDetails.attempts` and
  `ErrorInfo.attempts` are renamed `tries`, and `NoUsableAnswerError.lookupAttempts` is
  renamed `attempts`.
- Breaking: `lookup()`'s `source` option is renamed `protocol`.
- Breaking: `LookupManyItem` has an `ok` tag, and the hop types are unions on `status`: an
  answer always has `data` (and a WHOIS hop `raw`), and an error hop always has `error`.
- Breaking: `/utils` no longer exports `DOMAIN_SOURCE_TYPES`, `RDAP_SOURCE_TYPE`,
  `WHOIS_SOURCE_TYPE`, `DomainSourceType`, `getAllCountryCodes`, `RDAP_OBJECT_CLASSES`,
  `RDAP_ROLE_DESCRIPTIONS`, `transformRdapDomainData` or `transformWhoisDomainData`. The
  transforms are in `/whois`, and not stable. `RDAP_REGIONAL_REGISTRIES` and
  `WHOIS_REGIONAL_REGISTRIES` map a registry's name to its server. The root no longer
  exports `ProxyConfig`.
- Breaking: a numeric option that cannot be used (`timeout: 0`, `retries: 1.5`, `NaN`)
  throws `RangeError`, from the constructor and from each call.
- Breaking: `lookup()` returns `{ query, record, source }`. `attempts`, `provenance` and
  `discrepancies` are on the result only with `verbose: true`, typed as
  `VerboseLookupResult`; `lookupMany()` and `lookupAll()` take the option too.
  `NoUsableAnswerError` still carries `attempts`, and `whois()` and `rdap()` still return
  every hop. The `rdap-whois` command takes `--verbose`.
- Breaking: `issues` is removed from the lookup result and from `RdapHop`, with the
  `RdapIssue` and `RdapIssueCode` types. A creation date that cannot be right is still
  dropped from the record.
- Breaking: `nameservers`, `eppStatus` and `unmappedStatus` are `[]` when a server gave
  none, never `null`, in `DomainRecord` and `DomainData`.
- Breaking: the reseller is `record.reseller`, not `record.registrar.reseller`, and is kept
  when no registrar was named.
- `lookup()` takes `nullRedacted: true` to make a redacted contact or registrar value `null`,
  as if the server had not sent it ("REDACTED FOR PRIVACY", "Not Disclosed", "Please query
  the RDDS service…"). Off by default. A contact whose redacted values leave only its handle
  is `null`, and the other side's contacts are used when one side's were all placeholders.
  Known privacy services ("Domains By Proxy, LLC") count as redacted. Values with a URL,
  forwarding addresses and placeholder text with a real email address are kept, and the text
  is always in the verbose `attempts`. New: `isRedacted()` in `/utils`.
- Contacts that are only a handle no longer count as one side giving contacts, so the other
  side's are taken.
- An `eppStatus` discrepancy compares the `client*` codes only: a registrar listing fewer
  `server*` codes than the registry is not one.
- `lookup()` given a host looks up its registrable domain: `lookup('www.google.com')`
  answers for `google.com`, and `result.query` says so. Before, it answered
  `available: true`.
- When the registry's RDAP server says a name does not exist, `lookup()` no longer asks
  WHOIS, so an availability check makes one request instead of two. The exception is a name
  whose WHOIS registry sits below the RDAP one (`*.ac.uk`, `*.gov.uk`, CentralNic's zones).
- `lookup()` throws `NoUsableAnswerError` instead of answering `available` when one
  registry said it has the name and another said it does not.
- A registry and registrar answer is merged by part: statuses, nameservers and DNSSEC from
  the registry; contacts, the registrar's details and the updated date from the registrar;
  the earlier of the two creation dates that can be right. Records for name.com, porkbun.com
  and dynadot.com domains regain their statuses, and `opera.com` is created in 1999, not
  2017. New field: `provenance`, on a verbose result.
- `source.serverType` is `'registrar'` for a registrar's answer.
- `dnssec` comes from RDAP's `delegationSigned`, so unsigned Google Registry names (.dev,
  .app, .page and the rest) read `false`, not `true`.
- `getWhoisServer()` returns null, and `whois()` throws `NoServerError`, for a TLD IANA lists
  with no WHOIS server (.dev, .gr), and `lookup()` relies on RDAP alone for it. Before, the
  query went to IANA, whose record of the TLD itself was read as the domain's.
- A referral to a registrar no longer retries a proxy-tunnel failure. The first hop, IANA's
  referral, and referrals to regional registries or registries still do.
- `TimeoutError` is not retried, and is `retryable: false`, unless it came from waiting for a
  free connection or from a proxy that did not open its tunnel in time. A lookup whose
  registrar never answers takes about 10 s instead of 30 s.
- `registrar.ianaId` is `null` unless the server sent an IANA Registrar ID (.com.au no
  longer gives `802247`, and .nl no longer gives `0`).
- `.fr` and the other AFNIC TLDs' RDAP server is typed `registry`, not `regional`.
- WHOIS dates with a numeric offset (`+09:00`) are read at that offset instead of as UTC.
- RDAP nameservers lose their trailing dot, an empty registrar is `null`, `.ru` statuses are
  split, and whois.nic.uk's naming-rules refusal is an error hop.
- `detectQueryType()` treats any dotted, host-shaped name as a domain.
- An option set to `undefined` takes its default. Before, `{ timeout: undefined }` failed
  every request, and `retries`, `validate` and `totalTimeout` silently turned off.
- The default User-Agent is `rdap-whois/<version> (+https://github.com/aoxborrow/rdap-whois)`,
  and none is sent from a browser.
- The built package keeps the `node:` prefix, so it bundles for Cloudflare Workers.
- On Workers, one client shared by concurrent requests no longer stalls them.
- `i18n-iso-countries` and `lodash.merge` are no longer dependencies; country parsing gives
  the same answers.
- `/utils` is built on its own: importing one constant from it no longer pulls in tldts,
  punycode, ipaddr.js and html-entities (`EPP_STATUS_VALUES` alone: 6.5 kB, from 149 kB).

### Routing data

- 1,386 of 1,445 TLDs: 1,203 over RDAP and 1,254 over WHOIS.
