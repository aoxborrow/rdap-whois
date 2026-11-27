# Contributing

Pull requests are welcome: a new or corrected server, a response the parser reads wrong, a
bug fix. This is maintained in spare time, so there is no promise a pull request is
reviewed or merged, or by when, and there are no issue templates. A pull request that
comes with a recorded response and a test is the easiest to take. A security problem goes
through [SECURITY.md](./SECURITY.md), not an issue.

## Setup

Node 22.12 or later, and npm:

```bash
npm install
```

The generated tables (`src/whois/generated/`, `src/record/generated/`) are committed, so a
fresh clone builds and tests as it is; regenerate them only after changing what they are
made from.

| Command                    | What it does                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| `npm test`                 | unit tests, no network                                              |
| `npm run typecheck`        | TypeScript                                                          |
| `npm run eslint`           | lint                                                                |
| `npm run format`           | Prettier check (`npm run lint:fix` fixes both; `npm run lint` runs all three) |
| `npm run build`            | ES modules and type declarations into `dist/`                       |
| `npm run check:pack`       | build, pack, and import every entry point from the tarball          |
| `npm run check:browser`    | bundle every entry but the Node transport for a browser target      |
| `npm run check:examples`   | type-check `examples/` against `dist/` and run the offline one (installs its own dependencies from `examples/package-lock.json`; build first) |
| `npm run coverage`         | regenerate `docs/coverage.md` and the README's numbers (`-- --check` to verify) |
| `npm run who -- <query>`   | one lookup from the source, printed as JSON (`--whois`, `--raw`)    |

CI runs all of these but `who` on Node 22 and 24 for every pull request, forks included;
none of them needs a secret, and none but `check:examples`'s install needs the network.
`who` asks real servers, and so does `LIVE=1 npm test -- test/live.test.ts`, a small set
of lookups against real servers that is skipped otherwise.

Scripts that query servers or write fixtures read a `.env` in the package root:

```bash
RDAP_WHOIS_PROXY=socks5://user:pass@host:1080   # optional: send every request through a proxy
```

Rules the tests and lint enforce: Node built-ins only in `src/transports/`; `src/whois` and
`src/rdap` do not import each other; a new entry point goes in `exports`,
`publishConfig.exports` and `tsup.config.ts` together. `test/package.test.ts` checks what
each entry point loads: the root no WHOIS parser and no date parsing, `/utils` no network
code. `/utils` is built without shared chunks, and nothing it loads may import tldts,
punycode, ipaddr.js or html-entities (none is marked free of side effects, so a bundler would
keep all of each); `check:pack` fails when one constant from it bundles to more than 10 kB.
Comments on exported declarations and their members (options, result and record types,
errors, public functions and methods) are `/** */`, so they reach the type declarations and
show in editor hovers; every other comment is `//`.

The maintainers' tooling (registry health, discovery, the oracles) is described in
[docs/registry-health.md](./docs/registry-health.md).

## Adding or correcting a WHOIS server

One command, given the zone, the server, and a name known to be registered there:

```bash
npm run whois:add-server -- example whois.nic.example nic.example
```

It asks the server for the name and stops unless the answer is a record. Then it records
the answer as `fixtures/whois/found/<server>___<name>.txt` with the parse
beside it as `.json`; routes the zone to the server in `data/whois/tlds-extra.json` (a
zone nothing routes yet) or `data/whois/tlds-overrides.json` (replacing what another layer
says); regenerates `src/whois/generated/tlds.ts`; and prints which fields of a domain
record the parser left empty. Run `npm test` and commit what it wrote.

If fields come back empty that the response has, the server needs a format of its own:

1. Add `src/whois/servers/<server>.ts` exporting `config: FormatConfig`
   (`src/whois/formats.ts` documents every option). Start from a server with a similar
   response; most need only `format` and a few `aliases`.
2. `npm run whois:generate:servers` registers it.
3. `npm run whois:regen-goldens -- --server <server>` rewrites that server's goldens with the
   new parse. Read the diff: every changed value should be a fix.
4. `npm run whois:check-parsers` re-parses the whole corpus against its goldens, so a change
   meant for one server that moves another shows up.

To record another response from a server already routed, use
`npm run whois:record-fixture -- <server> <name>`.

An RDAP server comes from IANA's bootstrap file (`data/rdap/dns.json`, refreshed weekly).
A registry with an RDAP server IANA does not list goes in
`data/rdap/dns-overrides.json`.

`docs/coverage.md` lists every zone with its servers, parser and status. It is generated:
`npm run coverage` after changing the routing data or the fixtures (CI fails when it is
stale).

## Fixtures

A recorded response is the server's answer as it was sent, contact details included: WHOIS
serves them to anyone who asks. The one thing a recording changes is the address a server
says the request came from (`% Request from …`), which is the recording machine or its
proxy; it becomes a documentation address (`scripts/whois/lib/request-address.ts`). The
golden is built from the recorded text, so the pair always agrees.

To add a response by hand, save it with the `###%%%` headers the others have, replace any
echoed request address, and run `npm run whois:regen-goldens -- --server <server>`.

About half the responses have a golden beside them. Two kinds of test read the corpus:

- `test/whois/goldens.test.ts` parses every response that has a golden and compares the two.
- `test/whois/invariants.test.ts` checks what must hold for any response whatever it says:
  dates are real dates, nameservers are hostnames, statuses are EPP statuses, the parsed
  name is the one asked for, and a response filed as not-found, reserved or throttled is
  read as that. A new fixture is covered by these without a golden.

A contact field can hold a privacy notice, such as `REDACTED FOR PRIVACY`, as its value.
The library returns it as the server wrote it.

## Maintainers

### Releasing

Releases are cut by pushing a tag. `.github/workflows/release.yml` checks the tag matches
`package.json`, runs the offline checks, packs with `npm pack`, and publishes the tarball
with npm's trusted publishing and a provenance statement. A version with a prerelease suffix goes to the `next` dist-tag.

```bash
# on main, with a clean tree
npm version patch --no-git-tag-version   # or minor; edit package.json by hand if you prefer
# set VERSION in src/version.ts to the same version (a test checks they match), and in
# CHANGELOG.md move what is under Unreleased to a heading for the version, with its date
git commit -am "release: 0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

Routing data reaches users only in releases: there is no runtime download. So a merged
weekly registry-health pull request that changed `data/` or `src/whois/generated/` is
followed by a patch release. Code changes follow semver, with 0.x minors for breaking
changes.

One-time setup on npmjs.com: under the package's settings, add a trusted publisher for
GitHub Actions naming this repository, the workflow `release.yml` and the environment `npm`.
No npm token is stored in the repository.

### Registry health

`.github/workflows/registry-health.yml` runs every Monday, and on demand with a `dry_run`
sample. It probes every WHOIS server and RDAP base, the TLDs' and the registrars', through a
rotating proxy, refreshes
IANA's data, runs the parser regression and the oracle cross-checks, keeps the state in
`registry-health/`, and opens one rolling pull request with the data diff and
`registry-health/report.md`. A new outage with no RDAP to fall back on, or a top-100 parser
regression, opens a `registry-health` issue; a failing live suite opens a `live-suite`
issue.

Repository settings it needs:

| Name                                              | Kind     | What for                                                                                                                       |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PROXY_USERNAME_DEFAULT`, `PROXY_PASSWORD_DEFAULT` | secret   | the rotating proxy (WHOIS over SOCKS5, RDAP over HTTP CONNECT); `PROXY_HOST` and `PROXY_PORT` override the host                  |
| `REGISTRY_HEALTH_TOKEN`                           | secret   | optional: a token that may push and open pull requests, so the weekly pull request's own checks run (the default token's do not) |
| `REGISTRY_DATA_AUTOMERGE`                         | variable | `true` lets the weekly pull request merge itself when its checks pass                                                          |

The secrets are reachable only from the scheduled and manually started runs of this
repository. No workflow with a `pull_request` trigger uses a secret, so a pull request
from a fork gets the offline lanes (CI and the secrets scan) and nothing else. Do not add
`pull_request_target` to any workflow.

The headers of `scripts/registry-health/registry-health.ts` and the scripts it runs
explain the decision engine, the routing layers and the probe outcomes. A server is never
dropped from the routing data on one bad week: that takes repeated connection failures or
refusals, IANA dropping it, and a working RDAP server for the zone.

### Secrets scan

`.github/workflows/gitleaks.yml` runs gitleaks over the tree on every push and pull
request, with `.gitleaks.toml`. Add an allowlist entry only for a finding shown not to be
a secret, with a description saying why.
