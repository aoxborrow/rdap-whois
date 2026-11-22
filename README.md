# rdap-whois

[![npm version](https://img.shields.io/npm/v/@aoxborrow/rdap-whois.svg)](https://www.npmjs.com/package/@aoxborrow/rdap-whois)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/aoxborrow)

> Smart domain lookup combining RDAP and WHOIS, with one normalized result.

- **Smart Lookup** - Finds the best source for each domain: RDAP where the TLD supports it, falling back to WHOIS otherwise or when RDAP fails
- **One Normalized Record** - Whichever protocol answers, you get the same consistently structured, typed `DomainRecord`: registrar, dates as `Date` objects, EPP statuses, nameservers and DNSSEC
- **Registry and Registrar Merged** - Follows the registry's referral to the registrar and takes each field from the side that holds it
- **Availability Checks** - `record.available` and `record.reserved` tell you whether a name is free to register
<!-- coverage:start: written by `npm run coverage` from the routing data and the fixtures -->
- **1,386 of 1,445 TLDs** - 1,203 over RDAP and 1,254 over WHOIS (the other 59 publish no server),
  with WHOIS formats tuned for the servers of 127 TLDs and recorded responses testing 1,102 TLDs and 181 registrars.
  Every zone is listed in [docs/coverage.md](https://github.com/aoxborrow/rdap-whois/blob/main/docs/coverage.md)
<!-- coverage:end -->
- **Runs on Node.js and Workers** - WHOIS over `node:net` or `cloudflare:sockets` (no `nodejs_compat` flag), and RDAP anywhere `fetch` runs, browsers included where the server allows CORS
- **Zero-Config Defaults** - `lookup('example.com')` just works, with per-server rate limits (including the ones registries publish), retries with backoff, `Retry-After` and an overall deadline
- **Typed Errors** - Every error the library throws extends `RdapWhoisError`, with a `name` to switch on and a `retryable` flag
- **Safe With Untrusted Input** - Referral and redirect hosts come from server responses, so each one is checked before it is contacted (see [Which hosts may be contacted](#which-hosts-may-be-contacted))
- **Batteries Included** - An `rdap-whois` command-line tool, SOCKS5 and HTTP proxies, a pluggable cache, and a WHOIS parser you can use on its own

This library is extracted from [DNS.Tools](https://dns.tools). Check out our [Domain API](https://dns.tools/docs#domain) if you need a hosted version of this library.

> **Status: not published yet.** The first release will be 0.1.0.

## Install

```bash
npm install @aoxborrow/rdap-whois
```

Node.js 22.12 or later, or Cloudflare Workers. The package is ES modules only, with type
declarations; on Node, `require()` loads it too. Bun and Deno should work through their
Node compatibility, but neither is tested.

On Node 22.12, `require()` prints an `ExperimentalWarning` about loading an ES module; the
package still loads, and from Node 22.13 the warning is gone. With TypeScript 6, which no
longer includes `@types/node` by default, a project importing
`@aoxborrow/rdap-whois/transports/node` needs `"types": ["node"]` in its `tsconfig.json`
(and `@types/node` installed), because that entry's declarations name Node's modules.

## Quick start

```ts
import { lookup } from '@aoxborrow/rdap-whois';

const { record, source } = await lookup('google.com');

record.available;               // false
record.registrar?.name;         // 'Markmonitor Inc.'
record.creationDate;            // Date: 1997-09-15T04:00:00.000Z
record.expirationDate;          // Date: 2028-09-14T07:00:00.000Z
record.nameservers;             // ['ns1.google.com', 'ns2.google.com', 'ns3.google.com', 'ns4.google.com']
record.eppStatus;               // ['clientDeleteProhibited', 'clientTransferProhibited', ...]
record.dnssec;                  // false
record.registrant?.countryCode; // 'US'
source.protocol;                // 'rdap'
source.serverType;              // 'registrar'
```

`lookup()`, `whois()` and `rdap()` run on one default client, made on the first call
and shared by the whole program, so its per-server limits hold across every call. For a
proxy, a cache or other limits, make a client of your own: `new RdapWhois(options)` has
the same three methods, and keeping one for the life of the program keeps its limits.

### Lookup with options

```ts
import { memoryCache, RdapWhois, RdapWhoisError } from '@aoxborrow/rdap-whois';

// one client for the life of the program, so its per-server limits hold across calls
const client = new RdapWhois({
  timeout: 10_000,                                // one network exchange, in ms (default: 10000)
  retries: 2,                                     // resends after a temporary failure (default: 2)
  totalTimeout: 30_000,                           // one whole call, retries and referrals included (default: 30000)
  followReferrals: 1,                             // registry to registrar (default: 1)
  proxy: 'socks5://user:pass@proxy.example:1080', // for both protocols, or { whois, rdap } (default: none)
  cache: memoryCache({ max: 10_000 }),            // keep answers between calls (default: none)
});

try {
  // a call's options override the client's
  const { record } = await client.lookup('example.com', { protocol: 'whois', timeout: 5_000 });
} catch (error) {
  if (error instanceof RdapWhoisError) console.error(error.name, error.retryable);
  else throw error;
}
```

Every option is in [Options](#options). More programs are in
[`examples/`](https://github.com/aoxborrow/rdap-whois/blob/main/examples): many names at once, parsing a
saved response, proxies, a Redis cache and a Cloudflare Worker.

## The result

`lookup()` returns a `LookupResult`: the name, the record and the server it rests on. Dates
are `Date` objects, a field the servers did not give is `null`, and a list they did not give
is `[]`.

```ts
interface LookupResult {
  query: string;                       // the name looked up, in ASCII
  record: DomainRecord;                // the normalized record
  source: LookupSourceInfo;            // the server the record rests on: the registrar's when it answered
}

// lookup(name, { verbose: true })
interface VerboseLookupResult extends LookupResult {
  attempts: LookupAttempt[];           // every protocol tried, with every server asked and what it said
  provenance: RecordProvenance | null; // which side each part of the record came from; null for an available name
  discrepancies: Discrepancy[];        // fields where the registry and the registrar disagree
}

interface DomainRecord {
  domainName: string;                  // in ASCII
  domainNameUnicode: string | null;    // set for an IDN
  available: boolean;                  // the registry said the name does not exist
  reserved: boolean;                   // the registry holds the name back from registration
  creationDate: Date | null;
  updatedDate: Date | null;
  expirationDate: Date | null;         // the registrar's expiry, else the registry's
  registryExpirationDate: Date | null; // the registry's own, when it differs (mostly auto-renew)
  nameservers: string[];
  dnssec: boolean | null;              // null when no server said
  eppStatus: EppStatus[];              // EPP status codes, e.g. 'clientTransferProhibited'
  unmappedStatus: string[];            // statuses that map to no EPP code, as the server wrote them
  registrar: DomainRegistrar | null;   // ianaId, name, url, email, phone, abuseEmail, abusePhone, address, ...
  reseller: string | null;             // the reseller the registrar sold the name through, as written
  registrant: DomainContact | null;    // name, org, email, phone, address, countryCode, url, ...
  admin: DomainContact | null;
  tech: DomainContact | null;
  billing: DomainContact | null;
}

interface LookupSourceInfo {
  protocol: 'rdap' | 'whois';
  server: string;
  serverType: ServerType;              // 'registry', 'registrar', 'iana', 'regional' or 'unknown'
  url?: string;                        // the URL that answered, for RDAP
}
```

`lookup('google.com')` on 2026-11-22, trimmed, with dates as JSON writes them:

```jsonc
{
  "query": "google.com",
  "record": {
    "domainName": "google.com",
    "domainNameUnicode": null,
    "available": false,
    "reserved": false,
    "creationDate": "1997-09-15T04:00:00.000Z",
    "updatedDate": "2024-08-02T02:17:33.000Z",
    "expirationDate": "2028-09-14T07:00:00.000Z",
    "registryExpirationDate": "2028-09-14T04:00:00.000Z",
    "nameservers": ["ns1.google.com", "ns2.google.com", "ns3.google.com", "ns4.google.com"],
    "dnssec": false,
    "eppStatus": [
      "clientDeleteProhibited", "clientTransferProhibited", "clientUpdateProhibited",
      "serverDeleteProhibited", "serverTransferProhibited", "serverUpdateProhibited"
    ],
    "unmappedStatus": [],
    "registrar": {
      "ianaId": 292,
      "name": "Markmonitor Inc.",
      "abusePhone": "+1.2086851750",
      "countryCode": "US"
      // ...the other registrar fields
    },
    "reseller": null,
    "registrant": { "state": "CA", "countryCode": "US" }
    // ...admin, tech and billing, each a contact like registrant, or null
  },
  "source": { "protocol": "rdap", "server": "https://rdap.markmonitor.com/rdap/", "serverType": "registrar" }
}
```

With `verbose: true` the same lookup also has:

```jsonc
{
  // ...query, record and source as above
  "attempts": [
    // one per protocol tried; each hop has server, serverType, status, httpStatus, tries, elapsed and data
    { "protocol": "rdap", "hops": [/* the registry (rdap.verisign.com), then the registrar */] }
  ],
  "provenance": {
    "registrar": "registrar", "contacts": "registrar", "updatedDate": "registrar", "expirationDate": "registrar",
    "status": "registry", "nameservers": "registry", "dnssec": "registry", "creationDate": "registry"
  },
  "discrepancies": []
}
```

Every hop has a `serverType`: `'registry'`, `'iana'` or `'regional'` (an IP or AS
registry) for a server the routing data knows, and `'unknown'` for one it does not, such
as the registrar a registry referred to. An unknown server may refer on, but its "no such
name" never makes a name available. `source.serverType` is `'registrar'` when the result
rests on the registrar's answer.

## Stability

`0.x` follows semver, with breaking changes in minor releases (0.1 to 0.2). Within a minor:

- **Stable:** the `lookup()` result and `DomainRecord`, the options, the error classes and
  their `name`s, the cache interface, and the command's flags.
- **Not stable:** a WHOIS hop's parsed `data` (parser output; its fields can change in any
  release), an RDAP hop's `data` (the server's own JSON), and the exports marked not
  stable in [docs/api.md](https://github.com/aoxborrow/rdap-whois/blob/main/docs/api.md).
- **Routing data** (which server answers for which TLD) changes in patch releases.

Every release is in [CHANGELOG.md](https://github.com/aoxborrow/rdap-whois/blob/main/CHANGELOG.md).

### How old the data is

The routing data and the published limits ship inside the package: nothing is downloaded
at runtime, so a lookup never waits on IANA, and a release always behaves the same. The
data is checked against every server each week, and changes come out as patch releases, so
updating the package is how a lookup learns of a registry's new server. `DATA_VERSION` says
how old the copy you have is, as UTC dates:

```ts
import { DATA_VERSION } from '@aoxborrow/rdap-whois';

DATA_VERSION; // { rdapBootstrap: '2026-10-28', whoisTables: '2026-11-20', limits: '2026-11-20' }
```

`rdapBootstrap` is when IANA published the RDAP bootstrap file for domains, `whoisTables`
when the WHOIS server table last changed, and `limits` when the published per-server
limits last changed.

## Entry points

| Import                                   | What it has                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@aoxborrow/rdap-whois`                  | `lookup()`, `whois()` and `rdap()`, the `RdapWhois` client, `registrableDomain()`, RDAP's routing, the errors, the cache, `DATA_VERSION`, and every type they use |
| `@aoxborrow/rdap-whois/whois`            | `parseWhois()` for a response you already have, and WHOIS's routing                       |
| `@aoxborrow/rdap-whois/utils`            | Types and helpers for reading registration data: the record, EPP statuses, countries, RDAP responses, vCards. No network code, safe in a browser bundle |
| `@aoxborrow/rdap-whois/transports/node`  | The Node TCP transport, with `createConnect()` for a local address or TLS options             |

The client loads the WHOIS side (the parser, the per-server formats and the TLD table) the
first time a call needs it, so a program that only asks RDAP never loads it. The errors,
the cache and the option types come from the package root. Every export is listed in
[docs/api.md](https://github.com/aoxborrow/rdap-whois/blob/main/docs/api.md).

## Usage

### What `lookup()` answers

Every record is an answer from a server, one of three:

| `available` | `reserved` | Meaning                                                                 |
| ----------- | ---------- | ----------------------------------------------------------------------- |
| `false`     | `false`    | Registered: the record holds what the servers said about the name        |
| `false`     | `true`     | The registry holds the name back from registration                       |
| `true`      | `false`    | The registry itself said the name does not exist                         |

Everything else is thrown. A TLD with no RDAP or WHOIS server to ask is a `NoServerError`.
A timeout or a throttle is never reported as available. When servers answered but with too
little to use, and no registry said the name does not exist, that is a
`NoUsableAnswerError`, which carries what was tried as `attempts`. An answer is usable
when the server named the domain and gave a registrar, a registrant, nameservers or a
creation date. Two registries disagreeing (one has the name, one does not) is a
`NoUsableAnswerError` too, never `available`.

`lookup()` takes domain names. Given a host, it looks up the registrable domain the host
is under: `lookup('www.google.com')` answers for `google.com`, and `result.query` says so.
`registrableDomain()` does the same reduction on its own; it knows the ICANN public
suffixes and the zones below a TLD that have registries of their own (`ac.ru`, `gov.scot`,
`uk.com`). IP addresses, AS numbers and handles go to `whois()` or `rdap()`.

When the registry's RDAP server says a name does not exist, that is the answer, and WHOIS
is not asked: an availability check costs one request. The exception is a name whose WHOIS
registry sits below the RDAP one (`*.ac.uk`, `*.gov.uk`, CentralNic's `*.uk.com` and
`*.br.com`), where WHOIS is asked as well. To use one protocol only, pass
`protocol: 'rdap'` or `protocol: 'whois'`.

`source` is the server the record rests on: the registrar when it answered, with
`serverType: 'registrar'`, else the registry. With `verbose: true` the result also says how
the record was built:

- `attempts`: every protocol tried and every server asked, with each one's status, raw
  response, parsed data, timing and error. An entry's `protocol` says whether its `hops`
  are RDAP hops or WHOIS hops. This is most of a verbose result's size.
- `provenance`: for each part of the record, `'registry'`, `'registrar'` or `null`;
  `null` as a whole for an available name.
- `discrepancies`: where the registry and the registrar both gave a value and they
  differ. Five fields are compared: `creationDate` and `expirationDate` (only when more
  than a day apart), `nameservers`, the `client*` codes of `eppStatus` (the `server*` ones
  are the registry's alone) and `dnssec`. So google.com's two expiry dates, three hours
  apart, are no discrepancy.

`whois()` and `rdap()` return every server's answer too, and a `NoUsableAnswerError` always
carries `attempts`, verbose or not.

When the registry refers to a registrar, the record takes each part whole from the side
that holds it. Statuses, nameservers and DNSSEC come from the registry. Contacts, the
registrar's details and the updated date come from the registrar. The creation date is the
earlier of the two that can be right, and `expirationDate` is the registrar's (an RDAP
`expiration` or `registrar expiration` event), or the registry's when the registrar gives
none. Each part falls back to the other side when its own gave nothing. The registry's own
expiry is kept as `registryExpirationDate`, for when it differs from the registrar's: mostly
a registry that has auto-renewed the name a year ahead of the registrar, which matters for
expiry and drop monitoring. When
the registrar fails or says it has no such name, the record is the registry's answer, and
the failed registrar is in the verbose `attempts` beside it: a registrar's word never makes a name
available, and its failure never fails a lookup the registry answered. The rule, and the
measurements behind it, are in [docs/merge.md](https://github.com/aoxborrow/rdap-whois/blob/main/docs/merge.md).

Values are left as the servers wrote them, with a few exceptions: a date before 1985 (a
server's `1970-01-01` for "never") is null; statuses are EPP codes in `eppStatus`, and any
status that maps to none, such as RDAP's `transfer prohibited` (the registrar's lock or the
registry's), is kept as written in `unmappedStatus`; a phone extension is in `phoneExt` and
`faxExt`, apart from the number. The reseller is as the server wrote it.

Contact and registrar values come back as sent, placeholders included: "REDACTED FOR
PRIVACY", "Not Disclosed", "Please query the RDDS service of the Registrar of Record…" and
the others registries and registrars write. With `nullRedacted: true` such a value is `null`,
as if it had not been sent. A contact whose redacted values leave nothing but its handle is
`null`, and when one side's contacts were all placeholders, the other side's are used. The
text as sent is always in the verbose `attempts`. A known privacy service in place of the
holder ("Domains By Proxy, LLC", "Privacy service provided by Withheld for Privacy ehf") counts
as redacted, matched by its whole name so that "Zomato Media Private Limited" is kept, but a
forwarding address at one reaches the holder, so it stays. So does any value with a URL in it,
since that is often the only way to contact the holder, and placeholder text with a real email
address in it. An address on its own is nulled only when its mailbox is a placeholder
(`redacted@nominet.uk`, `***@***.***`). `isRedacted(value)` from
`@aoxborrow/rdap-whois/utils` is the same test, for data you have already.

### One protocol

```ts
import { rdap, whois } from '@aoxborrow/rdap-whois';

const hops = await whois('google.com');
// one entry per server asked: the registry, then the registrar it referred to
// [{ server: 'whois.verisign-grs.com', serverType: 'registry', status: 'found', raw, data, ... },
//  { server: 'whois.markmonitor.com', serverType: 'unknown', status: 'found', raw, data, ... }]

const [registry] = await rdap('google.com');
registry.data; // the RDAP response body, when the server answered
```

To parse a response fetched some other way or kept from earlier:

```ts
import { parseWhois } from '@aoxborrow/rdap-whois/whois';

const parsed = parseWhois(responseText, 'whois.verisign-grs.com'); // { status: 'found', data }
```

`parseWhois(raw, server, queryType = 'domain')` parses it as the client parses one it
fetched: `server` picks that server's format. A rate-limit page comes back as
`status: 'throttled'` with no data, and `whoisThrottleLine(raw, server)` says which line made
it one. The WHOIS hop's parsed `data` is parser output: its shape may change in any 0.x
release, unlike the record's.

`whois()` and `rdap()` take domains, IP addresses, AS numbers and entity handles, and send
the query as given (no reduction to the registrable domain). Both accept a `server` to ask
instead of the one the routing data names (`lookup()` does not: it asks the servers the data
names). Every server asked comes back as a hop with its status: a server that says it has
no such object is a hop with `status: 'notfound'`, and a referral that fails is a hop with
`status: 'error'` beside the hops that answered. A hop that answered always has `data`
(and a WHOIS hop `raw`), and an error hop always has `error`: checking `status` narrows
the type. Only the first server failing is thrown.

Where a query goes when no `server` is given:

| Query        | WHOIS                                           | RDAP                                                                                          |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domain       | the TLD's registry; `NoServerError` for a TLD IANA lists with no WHOIS server (.dev, .gr), and `whois.iana.org` for a TLD the routing data does not know | the TLD's registry from IANA's bootstrap file, else `NoServerError`                           |
| IP address   | `whois.iana.org`, which refers to the registry  | the regional registry from IANA's bootstrap files, else `NoServerError`                       |
| AS number    | `whois.iana.org`, which refers to the registry  | the regional registry from IANA's bootstrap file, else `NoServerError`                        |
| Entity       | `whois.iana.org`, which refers to the registry  | by the handle's tag (`GOGL-ARIN`, `ORG-X-RIPE`) from IANA's object tags; a handle with no known tag needs a `server` |

A WHOIS response is read as UTF-8 unless the routing data records another encoding for its
server (ISO-8859-1 for `whois.registro.br` and `whois.dinahosting.com`). `whois()` takes
an `encoding` (any name `TextDecoder` knows) to read the first server's response in
instead; a referral is always read in its own server's encoding.

A `server` you pass is trusted to refer whatever it is typed as.

### Many names

```ts
import { RdapWhois } from '@aoxborrow/rdap-whois';

const client = new RdapWhois();

for await (const item of client.lookupMany(names)) {
  // results arrive as each lookup finishes
  if (item.ok) console.log(item.query, item.result.record.available);
  else console.log(item.query, 'failed', item.error);
}

const all = await client.lookupAll(names); // collected, in the order given
```

`batchConcurrency` lookups are in flight at once (default 8). Each server stays inside its
own limit, so names on different registries proceed side by side while one busy registry
waits its turn. A failed lookup is an item with `ok: false` and the `error` it threw, never a
rejection of the batch.

## Options

Passed to the `RdapWhois` constructor, and all except `concurrency`, `minInterval` and
`serverLimits` to any single call, including the top-level functions.

```ts
interface RdapWhoisOptions {
  // time limits and retries
  timeout?: number;                          // one network exchange, in ms, queue time included (default: 10000)
  retries?: number;                          // resends after a failure that could be temporary (default: 2)
  backoff?: number;                          // the first retry delay in ms; each later one doubles (default: 250)
  totalTimeout?: number;                     // one whole call in ms, retries, referrals and waits included; Infinity for none (default: 30000)
  signal?: AbortSignal;                      // aborts every request made with these options

  // referrals and responses
  followReferrals?: number;                  // referrals to follow, e.g. from the registry to the registrar (default: 1)
  followRedirects?: number;                  // HTTP redirects an RDAP request may follow (default: 5)
  maxResponseBytes?: number;                 // the largest response to accept (default: 1000000)
  validate?: boolean;                        // check an RDAP response is about the domain asked for and its dates are believable (default: true)
  userAgent?: string;                        // the User-Agent header for RDAP requests (default: see below)

  // limits (concurrency, minInterval and serverLimits on the client only)
  concurrency?: number;                      // requests in flight to one server at a time (default: 2)
  minInterval?: number;                      // the shortest time between two requests to one server starting, in ms (default: 250)
  serverLimits?: Record<string, ServerLimit>; // { concurrency, minInterval } by server hostname, over the two above and the published limits
  batchConcurrency?: number;                 // lookupMany(), lookupAll(): lookups in flight at once (default: 8)

  // network
  proxy?: ProxyOption;                       // a proxy URL for both protocols, or { whois, rdap } (default: none); see Proxies
  targets?: TargetPolicy;                    // which hosts may be contacted: allowPrivate, allowInsecure, allow() (default: public hosts only)
  fetch?: FetchLike;                         // replaces the RDAP transport (default: the runtime's)
  connect?: Connect;                         // replaces the TCP connect, which WHOIS and proxied requests use (default: the runtime's)

  // events and caching
  onEvent?: (event: ClientEvent) => void;    // called for every request, retry, referral, redirect, fallback and transform error
  cache?: HopCache;                          // keeps each protocol's answers (default: none); see Caching
}
```

`lookup()` also takes `protocol: 'rdap' | 'whois'` to use one protocol, `verbose: true`
to return how the record was built, and `nullRedacted: true` to null the placeholder text
servers write for withheld values (see [The result](#the-result)).

`RdapWhoisOptions` is the type of the constructor's options and `CallOptions` of a call's
(`LookupOptions`, `WhoisCallOptions` and `RdapCallOptions` add each method's own). Every
option is optional, and one left out or given as `undefined` takes the default above. A
numeric option that cannot be used (`timeout: 0`, `retries: 1.5`, `NaN`) throws a
`RangeError`, from the constructor or from the call.

The default User-Agent is `rdap-whois/<version> (+https://github.com/aoxborrow/rdap-whois)`,
so RDAP operators can see what is asking and where to reach its maintainers. In a browser
none is sent: it is not a CORS-safelisted header, and sending one makes the browser ask the
server first, which many RDAP servers do not answer.

The limits belong to the client and hold across every call made with it. Some registries
publish a limit for their servers, and those ship with the library as `KNOWN_SERVER_LIMITS`,
each with its source: a server listed there gets its published limit in place of
`concurrency` and `minInterval`, and an entry in `serverLimits` wins over both. A published
limit is counted per address, so a client whose requests leave from many addresses can give
such a server a looser entry of its own.

A server that throttles holds back this client's other requests to it for its
`Retry-After` (or the backoff), so they do not pile onto a server that has just said stop,
and the retry waits as long. No wait is longer than the call's time left: a retry, or a
request queued behind a paused server, whose wait would not fit in `totalTimeout` fails at
once with the throttle or failure behind it. A request that times out is not sent again: a
server silent for `timeout` rarely answers the same request a second time. When the time
runs out mid-request, the call rejects with a `TimeoutError`; a referral that runs out of
time is a failed hop beside the answers before it.

### Caching

A `cache` keeps each protocol lookup's hops, the first server's and each referral's, so the
same query asked again makes no request. `whois()`, `rdap()` and both of `lookup()`'s
protocol lookups go through it.

```ts
import { memoryCache, RdapWhois } from '@aoxborrow/rdap-whois';

const client = new RdapWhois({ cache: memoryCache({ max: 10_000 }) });
```

`memoryCache()` keeps the hops in memory, in this process only: at most `max` protocol
lookups (default 1000), dropping the one used least recently past that, each for the
lifetime the client suggests. It copies the hops in and out, so changing what a call
returned does not change what the cache answers next.

Any object with `get` and `set` is a cache. One that stores the hops as JSON elsewhere, in
a key-value store, say, gives them back through `reviveDates()` (see
[Dates after JSON](#dates-after-json)). On Cloudflare Workers KV:

```ts
import { reviveDates, type CacheKey, type HopCache } from '@aoxborrow/rdap-whois';

const id = (key: CacheKey) =>
  `rdap-whois:${JSON.stringify([key.protocol, key.server, key.queryType, key.query, key.encoding])}`;

const kvCache = (kv: KVNamespace): HopCache => ({
  get: async key => {
    const text = await kv.get(id(key));
    return text ? reviveDates(JSON.parse(text)) : null;
  },
  // KV takes seconds, 60 at the least; the client's lifetime is in milliseconds
  set: (key, hops, ttl) =>
    kv.put(id(key), JSON.stringify(hops), { expirationTtl: Math.max(60, Math.ceil(ttl / 1000)) }),
});
```

On Redis, with `node-redis` and the same `id` (`ioredis` is the same with
`redis.set(id(key), text, 'EX', seconds)`):

```ts
import { createClient } from 'redis';

const redis = await createClient({ url: process.env.REDIS_URL }).connect();

const redisCache: HopCache = {
  get: async key => {
    const text = await redis.get(id(key));
    return text ? reviveDates(JSON.parse(text)) : null;
  },
  set: async (key, hops, ttl) => {
    await redis.set(id(key), JSON.stringify(hops), { EX: Math.ceil(ttl / 1000) });
  },
};
```

- **The key** is `{ protocol, server, query, queryType }`: the server asked first (the one
  the routing data names, or the `server` you passed; a hostname for WHOIS, a base URL for
  RDAP) and the query as it was normalized (`example.com` for `Example.COM`), plus
  `encoding` when a WHOIS call set one. Other options are not in it: give calls that differ
  in, say, `followReferrals` different caches.
- **`get`** is asked before the first request. Hops it returns are the answer and nothing is
  sent; `null` or `undefined` is a miss.
- **`set`** is called after a lookup that made its requests, with a suggested lifetime in
  milliseconds: an hour for an answer, five minutes for "no such object", one minute when a
  referral failed. A lookup whose first server failed is thrown and not cached.
- Both may return a promise. What either throws is not caught: it fails the call as a failed
  request would.
- Hops are plain data apart from their `Date` fields (in a WHOIS hop's `data`). A cache that
  stores them as JSON turns those back into dates with `reviveDates()`.

### Dates after JSON

A result's dates are `Date` objects, which JSON writes as ISO strings and reads back as
strings. `reviveDates()` gives them back:

```ts
import { reviveDates, type LookupResult } from '@aoxborrow/rdap-whois';

const result: LookupResult = reviveDates(JSON.parse(stored));
result.record.creationDate; // Date
```

It takes a `lookup()` result, a `lookupMany()` item, the hops of `whois()` or `rdap()` (what
a cache stores), one hop, or one record, and returns a copy. It finds the dates by field
name, never by what a string looks like: the record's `creationDate`, `expirationDate`,
`registryExpirationDate` and `updatedDate`, the two values of a
`creationDate` or `expirationDate` discrepancy, and the date fields of each WHOIS hop's
parsed `data`. An RDAP hop's `data` is the server's own JSON and stays as it is. A value that
is not a date string is left alone, so an object that still has its `Date`s comes back
unchanged.

### Proxies

```ts
import { RdapWhois } from '@aoxborrow/rdap-whois';

// one proxy for both protocols
new RdapWhois({ proxy: 'socks5://user:pass@proxy.example:1080' });

// one for each; a protocol with none goes direct
new RdapWhois({
  proxy: {
    whois: 'socks5://user:pass@proxy.example:1080',
    rdap: { url: 'http://user:pass@proxy.example:3128', connectTimeout: 5000 },
  },
});
```

A proxy is a URL, or `{ url, connectTimeout }` with how long connecting to the proxy and
getting a tunnel may take. The scheme says how the tunnel is asked for: `socks5://` for
SOCKS5, `http://` for HTTP CONNECT and `https://` for HTTP CONNECT over TLS to the proxy.
Either works for WHOIS and for RDAP. The target's name is always resolved by the proxy.
`proxy` can be set on the client and on any single call. A proxy whose tunnel times out is
retried, since a rotating proxy's next try leaves from another address.

### Which hosts may be contacted

RDAP referral links, WHOIS referral hostnames and redirect `Location` headers all come
from a server's response. Each is checked before anything connects to it: by default IP
literals, `localhost` and names that only mean something on a local network are refused,
and an `http://` RDAP server is upgraded to `https://`.

The check is on the name, not on the address it resolves to: a public-looking name that
resolves to a private address (`127.0.0.1.nip.io`, or a name rebound between the check and
the connection) gets through, because the transport resolves the name again when it
connects. A service that must never reach a private address enforces that where the
connection is made: in the `fetch` and `connect` it passes in, or with a network egress
policy. `targets.allow()` adds a check of your own on each name.

## Errors

Every error the library throws extends `RdapWhoisError`, and `name` tells them apart
(`RdapWhoisErrorName` lists them). Each has a `retryable` flag (whether the same request
could succeed if sent again), and the `protocol`, `server` and `query` it happened on where
those are known. `tries` says how many times the request was sent, when it was retried;
`ServerError` and `InvalidResponseError` carry the server's HTTP `status`, and
`RateLimitError` its `retryAfter` in milliseconds and the throttle page as `raw`. `toJSON()`
gives the plain-object form used inside results and events, with all of these but `raw`.

| Class                  | Retryable | When                                                                       |
| ---------------------- | --------- | -------------------------------------------------------------------------- |
| `InvalidQueryError`    | no        | The query is not a valid domain, IP address, AS number or handle, or the `server` asked for is one the target policy refuses |
| `NoUsableAnswerError`  | no        | `lookup()`: servers answered, none usably, and no registry said the name does not exist |
| `TimeoutError`         | through a proxy | Connecting or reading took longer than `timeout`. Retryable when a proxy did not open its tunnel in time, or when the wait was for a free connection to a busy server |
| `RateLimitError`       | yes       | The server refused the request because of a rate limit                     |
| `NoServerError`        | no        | No WHOIS or RDAP server is known for the query                             |
| `ProxyError`           | yes       | The proxy refused, rejected the credentials or could not reach the host    |
| `EmptyResponseError`   | yes       | The server closed the connection without sending anything                  |
| `InvalidResponseError` | no        | The response is unparseable, too large or about a different object, or it referred or redirected to a host the target policy refuses |
| `ServerError`          | for a 5xx | The server answered with an error of its own                               |
| `ConnectionError`      | yes       | The connection was refused, reset or closed early                          |

A call can also reject with errors that are not the library's own:

- **An abort** rejects with the signal's own reason: a `DOMException` named `AbortError`, or
  `TimeoutError` from `AbortSignal.timeout()`, or whatever reason you passed to `abort()`.
  Its name can match the library's `TimeoutError`; `instanceof RdapWhoisError` tells them
  apart.
- **A mistake in the call** is a `TypeError` or `RangeError`: a malformed proxy URL, an
  `encoding` the runtime does not know, a numeric option that cannot be used.

When an answer cannot be made into a record (a response shaped like nothing the parser
knows), `lookup()` passes over it as if the server had not answered, emits a
`transform-error` event with what was thrown, and keeps the error on that protocol's entry
in `attempts`; if nothing usable came of the lookup, it is the `NoUsableAnswerError`'s
`cause`.

An `onEvent` listener that throws does not break the lookup it is watching: what it throws
is dropped.

`instanceof` holds across two copies of the library in one program: an error from one copy
is an instance of the other copy's class of the same name.

## Runtimes

| Runtime            | RDAP                 | WHOIS                         | Tested                             |
| ------------------ | -------------------- | ----------------------------- | ---------------------------------- |
| Node.js 22.12 and up | yes                | yes                           | in CI on 22 and 24                 |
| Cloudflare Workers | yes, direct          | yes (`cloudflare:sockets`)    | in CI under `workerd`              |
| Bun, Deno          | should work          | should work (`node:net`)      | no                                 |
| Browsers           | where CORS allows it | no: there is no TCP socket    | the bundle, not the network        |

Bun and Deno implement the Node APIs the Node transport uses, so the library should work on
both; neither is tested, and a report that it does not is welcome.

The library picks the TCP transport when the first WHOIS or proxied request needs one: the
Workers one when `navigator.userAgent` is `'Cloudflare-Workers'`, which is how a Worker
identifies itself, and the Node one otherwise. A runtime that should not be told apart this
way, such as a test that sets `navigator.userAgent`, can pass `connect` to choose: the Node
transport's `connect` from `@aoxborrow/rdap-whois/transports/node`, or any function of the
same shape. The same check refuses a proxied RDAP request on Workers unless `fetch` is
given, because a Worker cannot make one with the runtime's own TLS; pass a `fetch` that
tunnels, such as the one from the `tunnelfetch` package, or use `proxy: { whois: url }` to
proxy WHOIS only.

On Workers the API is the same, and no `nodejs_compat` flag is needed: WHOIS goes over
`cloudflare:sockets`. Make the client at module scope, one per isolate, so its per-server
limits hold across requests. Limits are per isolate, and Cloudflare runs many, so heavy
traffic still reaches a registry from many places at once. To keep answers between isolates
and deploys, give the client a cache backed by KV (see [Caching](#caching)).

CI serves [`examples/worker`](https://github.com/aoxborrow/rdap-whois/blob/main/examples/worker/src/index.ts) with
`wrangler dev` (the `workerd` runtime, no `nodejs_compat` flag) on every change: a lookup
answered from its KV cache must pass, and a live WHOIS lookup over `cloudflare:sockets` is
tried as well.

## Command line

```bash
npx @aoxborrow/rdap-whois google.com                 # the combined record, as JSON
npx @aoxborrow/rdap-whois google.com --verbose       # with every server's answer and the merge
npx @aoxborrow/rdap-whois google.com --whois         # every WHOIS server's answer
npx @aoxborrow/rdap-whois google.com --whois --raw   # just the response text
npx @aoxborrow/rdap-whois 8.8.8.8                    # IPs, AS numbers and handles go to RDAP
```

Installed, the command is `rdap-whois`. It takes `--whois` or `--rdap` (one protocol),
`--raw`, `--verbose` (for a domain lookup), `--server <host or URL>` (with `--whois` or `--rdap`), `--referrals <n>`,
`--timeout <ms>`, `--proxy <url>`, `-h` and `--version`. Without `--proxy`, the
`RDAP_WHOIS_PROXY` environment variable is the proxy, which keeps its credentials out of
the shell's history. It exits 1 with the error's name on stderr when a lookup fails, and 2
on bad usage.

## Coverage

[`docs/coverage.md`](https://github.com/aoxborrow/rdap-whois/blob/main/docs/coverage.md) lists every zone the routing data knows (each
TLD, and the second-level zones with registries of their own): its RDAP and WHOIS servers,
the parser format each WHOIS server is read with, how many recorded responses test it, and
each server's status in the last weekly check. It is regenerated from the committed data
by `npm run coverage`, along with the numbers at the top of this README.

A server that is wrong or missing: see [Adding or correcting a WHOIS
server](https://github.com/aoxborrow/rdap-whois/blob/main/CONTRIBUTING.md#adding-or-correcting-a-whois-server).

## Limitations

- **`lookup()` is for domains.** IP addresses, AS numbers and entity handles go through
  `whois()` or `rdap()`, which return each server's raw and parsed answer but no
  normalized record.
- **WHOIS needs TCP port 43.** Browsers cannot do WHOIS, and some hosts and CI runners block
  outbound port 43. RDAP from a browser works only where the server allows CORS.
- **The WHOIS parser is best effort.** WHOIS has no standard format. Registry servers are
  covered by tuned formats and recorded tests; registrar servers are read with a generic
  key-value format and may miss fields.
- **Contacts are mostly redacted.** Most registries and registrars now return
  `REDACTED FOR PRIVACY` or nothing. The library returns what the server wrote.
- **Rate limits are per client.** Two clients or two processes do not share them, and
  registries that limit per address still see every client behind that address.
- **Routing data ships in the package.** A registry that moves its server needs a release;
  those come out as patch releases after the weekly check.
- **WHOIS stays a fallback.** A lookup never asks both protocols to fill one's gaps from
  the other, and parts are taken whole from one side: the registrar's contacts are kept as a
  set even when the registry's would name more.

## Alternatives

Checked against each library's README and published code on 2026-11-22.

| | rdap-whois | [rdapper](https://github.com/jakejarvis/rdapper) 0.18 | [whoiser](https://github.com/LayeredStudio/whoiser) 1.18 | [freewhois](https://github.com/joshterrill/freewhois) 1.3 |
| --- | --- | --- | --- | --- |
| RDAP | yes | yes | no | yes |
| WHOIS | yes, with the registrar's referral | yes, with the registrar's referral | yes, with the registrar's referral | no |
| One normalized record | yes | yes | no: each server's fields | no: the RDAP response |
| WHOIS on Cloudflare Workers | yes | no (RDAP only there) | no | does not apply |
| Per-server rate limits | yes, with registries' published limits | no (a custom `fetch` can add them for RDAP) | no | no |
| Proxies | SOCKS5 and HTTP CONNECT, for both protocols | RDAP only, through a custom `fetch` | no | no |

## Contributing

See [`CONTRIBUTING.md`](https://github.com/aoxborrow/rdap-whois/blob/main/CONTRIBUTING.md): setup, adding a server in one command, how
the fixtures are recorded, and releasing. Contributions are welcome without a promise of
review or turnaround. To report a security problem, such as a way past the target policy,
see [`SECURITY.md`](https://github.com/aoxborrow/rdap-whois/blob/main/SECURITY.md).

## Data sources and licences

The code is MIT licensed; see [`LICENSE`](https://github.com/aoxborrow/rdap-whois/blob/main/LICENSE).

- The RDAP routing data is IANA's RDAP bootstrap registry, plus servers found by probing.
  Each file is made into its lookup table the first time a query needs it, not when the
  library is imported.
- The WHOIS TLD table is built from the routing data in `data/whois`, which is layered.
  `tlds-ascii.json` is a snapshot of
  [`WooMai/whois-servers`](https://github.com/WooMai/whois-servers) (The Unlicense). Over
  it go the servers IANA's own WHOIS names for each TLD, servers found and verified by live
  probes, and hand-kept additions and corrections.
- Country names are generated from
  [`i18n-iso-countries`](https://github.com/michaelwittig/node-i18n-iso-countries) (MIT).
- The test fixtures are not part of the published package. The recorded responses are the
  servers' answers as they were sent; only the address a server says the request came from
  is replaced. `fixtures/whois/vendored` holds test responses from
  [`weppos/whois-parser`](https://github.com/weppos/whois-parser) (MIT) and
  [`likexian/whois-parser`](https://github.com/likexian/whois-parser) (Apache-2.0), each
  with its licence beside it; see
  [`ATTRIBUTION.md`](https://github.com/aoxborrow/rdap-whois/blob/main/fixtures/whois/vendored/ATTRIBUTION.md).
