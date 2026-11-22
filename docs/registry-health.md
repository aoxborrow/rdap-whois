# Registry health and the maintainers' tooling

_As built for 0.1 (2026-11-22). This is the maintainers' side of the package: the tooling
that keeps the routing data, the fixture corpus and the weekly registry-health run. None of
it is published._

## Layout

Everything below is in the repository and outside the published package: `files` in
`package.json` ships `dist`, the README, the licence and the changelog, and `check:pack` fails
if `scripts/`, `registry-health/`, `fixtures/`, `test/`, `src/` or `data/` reach the tarball.

| Path | What |
| --- | --- |
| `src/cli.ts` | the `rdap-whois` command (published as the package's `bin`, built to `dist/cli.js`) |
| `data/limits.json` | the per-server request limits registries publish, built into the library and applied by default |
| `data/rdap/`, `data/whois/` | the routing data's layers, built into the library |
| `scripts/lib/` | `paths.ts` (every directory the tooling reads or writes) and `client.ts` (the tooling's client, fetch and proxy) |
| `scripts/registry-health/` | `registry:health` (the weekly unit), the probe state, the throttling record, the discovery sources, the cross-diff and the community diff |
| `scripts/whois/` | the WHOIS lane (`whois:health`, probes, decisions, IANA sweep, discovery), the two TLD generators, the parser and fixture tools, the oracles (`oracles/`, with the Go and Ruby wrappers), `data/` (the Tranco name pool) and `archive/` |
| `scripts/rdap/` | the RDAP lane (`rdap:health`, probes, discovery, bootstrap refresh), the validation dry run, the hop comparison, the rdap.org redirect helper |
| `scripts/proxy-check.ts` | which address requests leave from through the proxy |
| `scripts/coverage.ts` | `docs/coverage.md` and the README's numbers |
| `registry-health/` | the committed state and reports: `state.json`, `decisions.json`, `report.md`, `throttling.json`, the sweep, diff and oracle reports and their carry-forward files |
| `fixtures/whois/` | the WHOIS fixture corpus, as the servers sent it (only an echoed request address is replaced) |
| `test/scripts/` | the tooling's unit tests (decision engine, compare, prune, generators, request-address replacement, discovery summary, fingerprints, the probe), plus the rdap.org check, which runs only with `LIVE=1` |

`scripts/whois/archive/` keeps the corpus tools from the parser rewrite that still run:
`fingerprint.ts` with `fingerprint-features.ts` (`whois:fingerprint`), `sweep-corpus.ts`
(`whois:sweep-corpus`) and `mine-aliases.ts` with `seeds/` (`whois:mine-aliases`).

Scripts import library internals by relative path (`../../src/...`): they are the
package's own tooling. Tooling dependencies (`whoiser` for the oracle,
`i18n-iso-countries` for the country tables) are `devDependencies`.

Script headers cite items of the two plans this tooling was built from: milestones M1–M6
and numbered sections of the registry-health plan, and Leg 1 (S1–S4) and Leg 2 (O1–O5) of
the WHOIS cross-validation plan. Those plans are kept in the archive of the repository the
package was developed in; this page describes what was built.

## Commands

Run as `npm run <script>`.

| Script | What |
| --- | --- |
| `who <query> [--whois \| --rdap] [--raw] [--server s]` | one lookup through the `rdap-whois` command, printed as JSON |
| `registry:health` | the weekly unit: `rdap:health`, then `whois:health`. Flags: `--report-only`, `--skip-refresh`, `--skip-probes`, `--decide-only`, `--discover`, `--sample N`, `--limit N` |
| `rdap:health`, `whois:health` | one lane each |
| `rdap:update`, `whois:update-tlds` | refresh the RDAP bootstrap files, sweep IANA for WHOIS servers |
| `rdap:check-servers`, `whois:check-servers` | probe every RDAP base / WHOIS server into `state.json` |
| `rdap:discover`, `whois:discover` | look for replacements for the problem set |
| `registry:cross-diff`, `registry:community-diff` | compare the routing layers with IANA, RDAP and the community lists |
| `whois:generate` (`:tlds`, `:servers`) | regenerate `src/whois/generated/` |
| `countries:generate` | regenerate `src/record/generated/countries.ts` from `i18n-iso-countries` |
| `whois:check-parsers`, `whois:regen-goldens`, `whois:check-meta`, `whois:scan-status` | the parser regression and golden tools, offline |
| `whois:record-fixture`, `whois:refresh-fixtures`, `whois:add-server`, `whois:gather-meta` | the fixture corpus |
| `whois:oracle-compare`, `whois:hop-compare`, `rdap:hop-compare`, `rdap:validate-dry-run` | cross-checks and measurements |
| `proxy:check` | the proxy's egress addresses and one lookup per protocol |
| `coverage` | `docs/coverage.md` and the README's numbers (`-- --check` fails when either is stale) |

The proxy comes from the environment, read by `scripts/lib/client.ts` from a `.env` in the
package root: either `RDAP_WHOIS_PROXY` (one URL for everything) or
`PROXY_USERNAME_DEFAULT` + `PROXY_PASSWORD_DEFAULT` (the rotating proxy CI uses: WHOIS
over its SOCKS5 side, RDAP over its HTTP CONNECT side, on `PROXY_HOST`/`PROXY_PORT`, default
`p.webshare.io:80`). Without either, requests go direct.

## Probe outcomes

`state.json` keeps one record per server with its last classification and the
consecutive-failure counter the decision engine reads:

- `healthy`, `notfound-fp`, `throttled`: alive, and reset the counter
- `refused`: the server answered with an error page instead of a record, such as Identity
  Digital's `TLD is not supported.` once a TLD left port 43 (the parser reads that page as
  status `error`). Counts as a failure, is listed under unhealthy routes, and is phase-out
  evidence like `dead-candidate`, but only for the TLD the probe asked about, since a
  shared server may refuse one TLD and answer the rest. It never makes a moat outage, since
  the server is up
- `suspect`, `error`: an empty or odd answer; counts as a failure, never phase-out evidence
- `dead-candidate`: timeout or connection failure; phase-out evidence

The counter starts again when the failures switch between phase-out evidence and odd
answers, so the gate's failure count is made only of evidence. Its age gate still runs from
the last healthy answer: any time without a proper answer counts toward the 45 days.

A server is never dropped from the routing data on one bad week: that takes repeated
connection failures or refusals, at least 45 days without a proper answer, IANA dropping it,
and a working RDAP server for the zone. Nothing is
adopted automatically either: discovery and the community lists propose, probes verify, and
the weekly pull request is reviewed by a person.

## Request limits

The tooling client keeps to the library's limits: 2 requests in flight per server, 250 ms
apart, unless `data/limits.json` has an entry for the server. Each entry gives its source;
where a registry says it limits but publishes no number, the entry is cautious (one at a
time, 0.5–1 s apart). Registries checked that publish nothing (Verisign, PIR, CentralNic,
GoDaddy Registry, EURid, SIDN, CIRA, IIS, auDA) get the default; Identity Digital publishes
10 a second per address, which the default keeps under. Nominet's published 1,000 queries a
day on `whois.nic.uk` is not something a spacing can express. When an entry changes, bump
the file's `updated` date, which `DATA_VERSION.limits` reports.

Each probe lane folds the throttling it saw into `registry-health/throttling.json`: per
host, how many runs it throttled in, when, and the limit that was applied. `report.md`
lists them. A server that keeps throttling under the default is a candidate for an entry.

## Cross-validation

Two checks run inside `whois:health` and add a section each to the weekly report.

**Community server lists** (`registry:community-diff`). Debian's `whois` (its
`tld_serv_list`, over a layer synthesized from `new_gtlds_list`) and weppos's `tld.json`
are diffed in full against the routing data, into three buckets: a TLD they route and the
routing data does not, a TLD where the servers differ, and a TLD only the routing data
routes. With `--probe` (write mode), the first two are probe-verified, capped per run, and
a candidate that answers lands in the discovered layer as a reviewable diff. A difference
reviewed and kept is recorded in `registry-health/community-known.json`, so only new ones
surface. likexian's and whoiser's clients ship no server list (both ask IANA), so the
IANA sweep already covers them.

**Parser oracles** (`whois:oracle-compare`). The same raw text is parsed by
[likexian/whois-parser](https://github.com/likexian/whois-parser) (Go),
[weppos/whois-parser](https://github.com/weppos/whois-parser) (Ruby) and whoiser
(TypeScript, a pinned dev dependency imported by file path), and the fields are compared
with this library's parse after one normalization (`scripts/whois/oracles/schema.ts`). The
Go and Ruby wrappers live in `scripts/whois/oracles/`, pinned by their committed `go.sum` and
`Gemfile.lock`; their toolchains are needed only by the weekly job. It runs over the
fixture corpus and over a small live sample (25 names by default), where this library's own
RDAP answer joins as a fourth voice. The oracles are signal, not truth: whoiser counts only
toward "somebody extracted a value here and this library returned null". Reviewed
differences are kept in `registry-health/oracle-known.json`. A new miss on a top-100 TLD or
top-100 registrar server that at least two oracles agree on turns the run red.

## The weekly workflow

`.github/workflows/registry-health.yml`, Mondays 13:00 UTC, three jobs:

- **refresh** runs `registry:health` in write mode, regenerates the coverage page and the
  README's numbers, runs the package's type check and unit tests over the refreshed data
  (offline), then opens or updates the rolling pull request (`registry-health/weekly`) with
  only `registry-health/`, `data/whois/`, `data/rdap/`, `src/whois/generated/`,
  `docs/coverage.md` and `README.md`. If the offline checks passed and the repository
  variable `REGISTRY_DATA_AUTOMERGE` is `true`, the pull request is set to merge itself when
  its required checks pass. A pull request opened with the default token starts no
  workflows, so a `REGISTRY_HEALTH_TOKEN` secret is needed for its checks to run. The job
  does not fail on an actionable regression; it records it.
- **alert** opens or comments on one `registry-health` issue when the refresh found an
  outage with no RDAP to fall back on, a top-100 parser regression or oracle divergence, or
  did not finish, and closes it on the next clean run.
- **live** runs the library's live suite (`LIVE=1`, plus the rdap.org check) and keeps one
  `live-suite` issue the same way.

`workflow_dispatch` with `dry_run` runs a report-only sample that writes nothing and opens
no pull request or issue. A merged weekly pull request that changed the routing data is
followed by a patch release, since routing data reaches users only in releases.

## Licences of what the community diff keeps

`whois:discover` and `registry:community-diff` fetch Debian's `tld_serv_list` and
`new_gtlds_list` (GPL) and weppos's `tld.json` (MIT) at run time; their text is never
written to the repository. `community-diff.json` and `community-known.json` keep, for the
TLDs where a list differs from the routing data, the TLD and the server hostname that list
names (Debian: 242 of its 1,421 entries; weppos: 426 of 1,320). A TLD-to-server pair is a
fact about the DNS, not the lists' expression, and the files are reports in the repository,
not part of the published package. Checked 2026-11-16: they can stay as they are.
