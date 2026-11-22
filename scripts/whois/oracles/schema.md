# Oracle wrapper contract

The compare harness (`../oracle-compare.ts`, docs/registry-health.md Leg 2) only
ever sees one normalized JSON shape. TypeScript oracles implement it against
[`schema.ts`](schema.ts); the non-TS CLI wrappers (`likexian/`, `weppos/`) implement this
document. Wrappers are **inert files** — nothing in `yarn build`/`lint`/`test` touches
them; only the registry-health CI job and devs with the toolchains build/run them.

## Invocation

Two modes, same JSON per response:

- **Batch (required for the corpus):** `<wrapper> --dir <path>` — parse every `*.txt` in
  the directory, one NDJSON object per file on stdout, `"file"` set to the filename.
  Files are named `<server>___<query>.txt`; the wrapper derives the responding WHOIS host
  (and the queried name) from the filename. This matters: weppos selects its parser class
  by host, so raw text alone cannot be parsed faithfully.
- **Single:** raw text on stdin; `--server <host>` supplies the responding host
  (likexian, host-independent, may ignore it). One JSON object on stdout, no `"file"`.

The caller strips fixture provenance headers (`###%%% …` lines) before handing text to a
wrapper — wrappers never see corpus metadata.

## Output shape

```json
{
  "file": "whois.nic.fr___example.fr.txt",  // batch mode only
  "notFound": false,   // the response says the name is unregistered
  "reserved": false,   // reserved / blocked / premium — not parseable registration data
  "fields": { ... }    // omit or null any field the library did not extract
}
```

A wrapper that cannot parse a response at all emits `{"file": ..., "error": "<message>",
"fields": {}}` instead — never a crash, never a skipped line.

## Fields

The comparable set (see `ORACLE_FIELDS` in `schema.ts`): `domain_id`, `domain_name`,
`registrar_id` (IANA ID where the library has it), `registrar_name`, `registrar_url`,
`registrar_whois_server`, `registrar_abuse_email`, `registrar_abuse_phone`,
`creation_date`, `updated_date`, `expiration_date`, `dnssec`, `status` (array),
`nameservers` (array), `registrant_name`, `registrant_org`, `registrant_email`,
`registrant_country`, `admin_name`, `admin_email`, `tech_name`, `tech_email`.

Wrappers emit values **as the library produced them**, with one exception: a date the
library parsed into a real time value is emitted as RFC 3339 UTC. Wrappers must be
timezone-independent — a zone-less registry date must produce the same output on every
machine (the Ruby wrapper pins `TZ=UTC` for exactly this). All other cleanup
(lowercasing, EPP-URL stripping, trailing dots, redaction placeholders, sorting) is the
harness's job — `normalizeValue()` in `schema.ts` — so the rules live in exactly one
place.

## Pinning

Upstream libraries are declared (`go.mod` / `Gemfile`) and pinned by the committed
lockfiles (`go.sum` / `Gemfile.lock`); their source is never vendored. Build/run:

```
# likexian (Go)
cd likexian && go build -o likexian-oracle .

# weppos (Ruby)
cd weppos && BUNDLE_PATH=vendor/bundle bundle install
```

The harness auto-detects what's built (`likexian/likexian-oracle` present; `bundle check`
passes in `weppos/`) and runs with whatever subset exists — whoiser (npm devDependency,
in-process) is always available.
