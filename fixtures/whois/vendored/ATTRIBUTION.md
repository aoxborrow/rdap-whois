# Vendored whois fixtures

Third-party whois responses, vendored to supplement the **negative-case lane** of the
parser rewrite (`docs/archive/whois-parser-refactor.md` P1). Our own corpus has broad `notfound/`
coverage (1,204 responses) but is thin where it matters most for the availability work:
`reserved/` (11) and `throttled/` (32). These fill that gap.

Everything here is **read-only test input**. Nothing in this directory is shipped, served,
or imported by runtime code — only by the offline harnesses under
`packages/backend/src/tools/{whois,rdap}/scripts/` (and the shared coordination core at
`packages/backend/scripts/registry-health/`).

## Staleness rule (`docs/archive/whois-parser-refactor.md` P1)

**Vendored fixtures validate the ENGINE. Only a live probe validates the PATTERN for
today's registry output.**

A vendored response proves our tokenizer/meta detection handles a given response *shape*.
It does **not** prove any registry still answers that way — weppos's corpus was frozen in
2022. So: a vendored fixture may justify adding a detection pattern, but a pattern only
counts as verified for a server once a live probe confirms it (P5 asserts this per
server). Never re-baseline a golden from vendored data.

## Provenance

Each file keeps its provenance in `###%%%` headers (the same convention as our own
fixtures; `stripRawMetadata()` removes them before parsing, so they never reach the
tokenizer):

```
###%%% SRV: whois.aero
###%%% SRC: weppos/whois-parser@<sha> spec/fixtures/responses/whois.aero/status_reserved.txt
###%%% LIC: MIT — Copyright (c) 2009-2022 Simone Carletti
###%%% NOTE: vendored fixture, frozen 2022 — validates the ENGINE, not today's registry output
```

### `weppos/` — 282 files

- Source: <https://github.com/weppos/whois-parser> @ `bedb4a48b0c9b28dad1c18e5d2bd0f761642927c` (2022-09-08)
- Path: `spec/fixtures/responses/<host>[/<tld>]/<case>.txt`
- License: **MIT** — Copyright (c) 2009-2022 Simone Carletti (full text: `weppos/LICENSE.txt`)
- Last release 2.0.0 (2022-09); effectively frozen. See the plan's §9a.

| dir | files | mapped from | meaning |
|---|---|---|---|
| `notfound/` | 242 | `status_available.txt` | their "available" is our `notfound` meta — the domain is not registered |
| `throttled/` | 18 | `response_throttled.txt` | rate-limited |
| `reserved/` | 15 | `status_reserved.txt` | reserved by the registry |
| `invalid/` | 7 | `status_invalid.txt` | malformed query; no meta state of ours claims these yet |

### `likexian/` — 88 files

- Source: <https://github.com/likexian/whois-parser> @ `2426ff1e36f7540b2e0e7f69324cbe2091f5b278` (2026-01-04)
- Path: `testdata/notfound/<tld>_<domain>`
- License: **Apache-2.0** — Copyright 2014-2026 Li Kexian (full text: `likexian/LICENSE`)
- Actively maintained; current through 2026, so fresher than weppos. See the plan's §9b.

| dir | files | meaning |
|---|---|---|
| `notfound/` | 88 | domain not registered |

## Changes from upstream

- Every file has the `###%%%` provenance headers above prepended and a new file name:
  `<server>___<tld>.txt` for `weppos/`, the upstream name plus `.txt` for `likexian/`.
- In 15 `weppos/` and 8 `likexian/` files the server says back the address the request came
  from (`% Request from …`, `%% [… REQUEST] >> …`, `Source IP: …`). That address is replaced
  with the documentation address `192.0.2.1` (2026-11-11).
- Every file changed this way says so in a `###%%% CHG:` header line.

## Re-importing

Vendored deliberately (committed files, not a fetch step) so the harness stays offline and
the review diff shows exactly what landed. To refresh, re-download both repos at a new
commit, re-run the conversion, and update the SHAs above and in the `###%%% SRC:` headers.
