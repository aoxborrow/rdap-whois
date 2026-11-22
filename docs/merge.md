# Merging the registry's and the registrar's answers

_As built in 0.1 (2026-11-22). It was first planned for after 0.1.0 and pulled into 0.1
instead. The code is `combineHops` in [`src/record/record.ts`](../src/record/record.ts)._

A domain lookup usually gets two answers: the registry's, then the registrar's that the
registry refers to. `lookup()` builds one record from them. Each group of fields comes whole
from the side that holds it, and the result says which side that was.

## The rule

There is no setting. A caller who wants one server's answer has it already: `whois()` and
`rdap()` return every hop, and `lookup()` with `verbose: true` returns them in `attempts`.

| Group | Fields | Taken from | Falls back to the other side when |
| --- | --- | --- | --- |
| Status | `eppStatus`, `unmappedStatus` | registry | the registry gave no status |
| Nameservers | `nameservers` | registry | the registry gave none |
| DNSSEC | `dnssec` | registry | the registry gave no value |
| Creation date | `creationDate` | the earlier of the two that can be right | — |
| Contacts | `registrant`, `admin`, `tech`, `billing`, as one set | registrar | the registrar gave no contact with more than a handle |
| Registrar | name, IANA ID, address, phone, email, URL, abuse contact | registrar | the registrar gave neither a name nor an IANA ID |
| Updated date | `updatedDate` | registrar | the registrar gave none |
| Expiry | `expirationDate` | registrar (its `registrar expiration` counts), else registry | — |
| Registry expiry | `registryExpirationDate` | registry only: its own date, which differs from the registrar's mostly after it auto-renewed the name | — |

- **Groups are taken whole.** Never the registrar's email from one server and its address
  from the other, and never one registry contact inside a registrar's set. With
  `nullRedacted`, redacted values are taken out of each side first, so a side whose contacts
  were all placeholders gave none, and the other side's are used. Whether an answer is
  usable is judged before that, on what the server sent.
- **Creation date.** Each side's date is checked first: one in the future, after that
  server's own expiry, or before 1985 (a placeholder) is passed over. Of the dates left, the
  earlier wins. A registrar's date is often the day the name moved to it.
- **Expiry.** `expirationDate` is the registrar's date whenever one was given, by the
  registrar or passed on by the registry in its own answer, so there is no separate field
  for it. Provenance names the server, not whose date it is: a registry that passes on the
  registrar's date is still `registry`. When `expirationDate` differs from
  `registryExpirationDate`, it is the registrar's. A two-hop lookup whose sides differ by
  more than a day also lists both in an `expirationDate` discrepancy.
- **The reseller** is the registrar's, else the registry's. It is `record.reseller`, beside
  `registrar` rather than inside it, so it is kept when no registrar was named.
- **Which hop is the registry** is decided by server type, not by position. A lookup that
  began at IANA (a TLD the routing data has no server for) types the server IANA named as
  the registry. With no registrar hop, the record is the last answer as it is.
- **A registrar that failed or named another domain** gives nothing, and the record is the
  registry's alone.
- **WHOIS stays a fallback.** A lookup never asks both protocols to fill one's gaps from the
  other. The rule is the same for both protocols.

## What the result says

`source` is always on the result. `provenance` and `discrepancies` are there with
`verbose: true`, beside every server's answer in `attempts`.

- `provenance` names, per group, `'registry'`, `'registrar'` or `null` (neither side gave
  it, or a single answer came from a server the routing data doesn't know). It is `null` for
  an available name.
- `discrepancies` lists where both sides gave a value and they differ: creation and expiry
  dates more than a day apart, the nameserver set, the `client*` statuses and DNSSEC. Only
  the `client*` codes are compared because the `server*` ones are the registry's by
  definition: a registrar listing one status against the registry's four (opera.com) is
  not a disagreement. A registrar listing a `client*` status the registry doesn't shows up
  here, since the record carries the registry's statuses.
- `source` is the server the result rests on: the registrar when it answered, with
  `serverType: 'registrar'`.

## DNSSEC values

`dnssec` comes from RDAP's `delegationSigned`, which says whether the parent holds DS records
for the name. `zoneSigned` describes the zone the name sits in: Google Registry sends
`zoneSigned: true` for every .dev, .app and .page name, signed or not. Without
`delegationSigned`, DS or key data means signed.

## Data

### Where both servers answered (2026-11-09)

794 names over RDAP, 128 over WHOIS.

| | RDAP (794) | WHOIS (128) |
| --- | --- | --- |
| Creation date more than a day apart | 18: registrar later in 13, earlier in 5 | 0 |
| Registrar has no creation date | 0 | 1 |
| Registrar has no expiry of any kind | 2 | 1 |
| Registrar has only a `registrar expiration` event | 278 | does not apply |
| Nameservers: same | 759 | 127 |
| Nameservers: registrar lists a strict subset | 24 | 0 |
| Nameservers: registrar lists none | 0 (9 where neither does) | 1 |
| Status: same | 628 | 121 |
| Status: registrar lists a strict subset | 18 | 0 |
| Status: registrar lists none | 4 | 3 |
| Status: registrar lists more | 26 | 3 |
| Status: each has some the other lacks | 118, mostly wording | 1 |
| Registrar gives no registrar name | not recorded | 1 |
| Contacts | not compared | registrar has 43 fields against 15 |

- **Status wording.** The 118 are mostly `transfer prohibited` at the registrar against
  `client transfer prohibited` at the registry. The unqualified form maps to no EPP code and
  stays in `unmappedStatus`.
- **A status subset.** `cloud.microsoft`: the registrar lists three client statuses, the
  registry those plus three server ones. `visit.brussels`: the registry adds
  `autoRenewPeriod`. Registrars for name.com, porkbun.com and dynadot.com domains send no
  status at all, so before this rule those records had none.

### The 18 creation dates

From `registry-health/hop-compare.json` (2026-11-10). The earlier date is right in every
case, so the rule takes it.

| Name | Registry | Registrar | Taken |
| --- | --- | --- | --- |
| opera.com | 1999-04-14 | 2017-06-06 | registry |
| taboola.com | 2007-02-23 | 2021-02-04 | registry |
| myfritz.net | 2011-09-22 | 2011-12-26 | registry |
| football.london | 2016-10-26 | 2024-12-06 | registry |
| fiba.basketball | 2018-04-16 | 2021-05-28 | registry |
| skyhigh.cloud | 2021-02-15 | 2022-01-28 | registry |
| remarketing.company | 2014-03-22 | 2014-12-23 | registry |
| euskadi.eus | 2014-11-25 | 2023-06-25 | registry |
| lemel.gallery | 2014-04-03 | 2023-05-03 | registry |
| nar.realtor | 2015-07-07 | 2015-07-29 | registry |
| opera.software | 2015-03-20 | 2017-06-06 | registry |
| opera.technology | 2014-12-22 | 2017-06-06 | registry |
| katholiekonderwijs.vlaanderen | 2014-12-11 | 2016-08-10 | registry |
| google.com.bh | 2018-10-18 | 2003-03-04 | registrar |
| student.monash | 2022-11-24 | 2020-03-24 | registrar |
| extramovies.miami | 2025-12-06 | 2025-12-05 | registrar (one day, a time zone) |
| futemax.reise | 2026-05-31 | 2026-05-30 | registrar (one day) |
| maxwin88pandai.skin | 2026-03-17 | 2026-03-16 | registrar (one day) |

The 13 where the registrar is later carry the date the name moved to that registrar. In
the two real cases where the registry is later (google.com.bh, student.monash), the
registry's object is newer than the registration.

### DNSSEC disagreement (2026-11-22)

400 names from the same sample looked up live over RDAP, after the `delegationSigned` fix:
233 had both a registry and a registrar answer, and both sides gave a DNSSEC value in all
233. They disagreed on **5 (2.1%)**: bid.cars, private.coffee, remarketing.company,
trans.fish and meme.holdings. In all five the registry holds DS records and says signed,
while the registrar says `delegationSigned: false`. One of them (remarketing.company)
sends the same DS record while saying so. The registry's value is the right one each time.

### The same hops combined two ways (2026-11-10)

Six names, each fetched once and combined as "registry fills every field" and as "last hop
as it is". They are why groups are taken whole.

| Name | What it shows |
| --- | --- |
| `github.io`, WHOIS | Filling field by field returned the registry's registrant, `REDACTED` in every field but the organisation, and added admin and tech contacts made only of `REDACTED`. The registrar's answer has one registrant and no other contacts |
| `wikipedia.org`, `cloudflare.com`, RDAP | Field by field gave the registrar's own address with the abuse phone number the registry holds, not the one the registrar publishes |
| `opera.com`, RDAP | The registrar's answer: created 2017 (registry: 1999), one status of four, no DNSSEC value, no registrar entity |
| `namecheap.xyz`, WHOIS | DNSSEC signed at the registry, unsigned at the registrar, identical nameservers |
| `namecheap.xyz`, RDAP | The registrar sends a `registrar expiration` event and no `expiration` event |
| `lerevenu.com`, both | Expiry 2027-08-29 at the registry and 2026-08-29 at the registrar: the registry has auto-renewed |

The updated date differed in every one: the registrar's is when its own record changed.

## What the rule gives up

- `github.io`: the registry's registrant has the organisation name, and the registrar's has
  it redacted. Keeping the registrar's contacts whole loses the name.
- A registrar WHOIS answer the generic format couldn't read parses to no contacts, and the
  registry's set is then used. `provenance.contacts` says so.
