// A "format" is a named tokenizer profile + default alias table. The naming insight: response
// shape follows the registry OPERATOR or registry SOFTWARE, not the TLD — so one format
// covers many servers. The formats came out of clustering recorded responses by their
// shape, not from assigning servers by hand.
import type { TokenizerOptions, ContactRole } from './blocks';
import type { ParserOptions } from './data-types';

// meta states, detected from format-level ANCHORED patterns rather than an over-broad
// substring match, which finds "not found" in a registry's terms of use. `servfail` (registry error/maintenance page, or a server
// asked for a TLD it doesn't serve — named for DNS's SERVFAIL, and deliberately NOT
// "unavailable" so it can never be confused with a future `available` registration state)
// is distinct from `throttled` and must resolve to lookup-failed/unknown — never
// "available", never a garbage-parsed "registered".
export type MetaKind = 'notfound' | 'throttled' | 'reserved' | 'servfail';

// meta states that GATE mapping: an error page never yields data fields. A notfound
// or reserved response is still tokenized — its (absent) fields are the point — but a
// throttled/servfail response carries no domain data at all, so extracting from it
// could only produce garbage.
export const GATING_META: MetaKind[] = ['throttled', 'servfail'];

// canonical field → ordered list of source keys. ORDER IS THE COLLISION RULE: when
// several source keys map to one canonical field in the same scope, the first alias
// PRESENT in the response wins and the losers stay in the leftover set (visible in the
// drift report). That makes `Registry Expiry Date` vs `Registrar Registration Expiration
// Date` disagreements deterministic and observable, instead of regex-order luck.
export type AliasTable = Record<string, string[]>;

// a FIELD-FILTERED handle reference (see handleRefs below): the role the reference confers
// plus the only subfield suffixes it may pull from the referenced contact block
export type HandleRef = { role: ContactRole; fields: string[] };

// How pass 2 discovers a contact's ROLE:
//   'key-prefix'  — the role is in the key itself (`Registrant Name`). icann/generic-kv/
//                   cocca. The default; needs no block or handle machinery.
//   'block-label' — the role/field comes from an empty-value SECTION HEADER, and the
//                   entries under it are role-less (`Name`, `Website`, bare hostnames).
//                   The labeled-blocks family (eurid, nominet, …); pairs with the
//                   tokenizer's `empty-value` mode.
//   'handle-ref'  — the domain block REFERENCES contacts by handle (`holder-c`, `admin-c`),
//                   and separate contact blocks are keyed by that handle (`nic-hdl`,
//                   `contact`). rpsl (AFNIC/RIPE-db) and fred (CZ.NIC). Role is resolved by
//                   matching the reference to the block's own handle.
export type RoleResolution = 'key-prefix' | 'block-label' | 'handle-ref';

// A block "scope" is a contact/registrar prefix (`registrant`, `admin`, `tech`, `billing`,
// `registrar`) that combines with a subfield suffix to name a canonical field: scope
// `registrant` + suffix `name` → `registrantName`. `block-label`/`handle-ref` formats map
// role-less keys this way instead of spelling out every `<role>_<field>` alias.
export type ScopePrefix = ContactRole | 'registrar';

// POSITIONAL blocks: the hardest cluster — a section
// whose body is BARE lines with no keys at all, where a field is identified only by its LINE
// POSITION (twnic/za.net/educause/nic.sm: line 1 = name/org, line 2 = street, …). A
// declarative per-server template reads them, so the format stays data, not code.
//
// A slot is either a plain suffix (take the next bare line in document order) or a
// SHAPE-matched suffix (pull the one bare line matching a content shape — an email has `@`, a
// phone starts with `+`/digits — regardless of its position, so a missing/extra earlier line
// can't misalign it). `skip` consumes a line without assigning it.
export type PositionalSlot =
  string | { field: string; match: 'email' | 'phone' | 'country' | 'url' } | { skip: true };

export type PositionalTemplate = {
  scope: ScopePrefix;
  // the header line's OWN value (`Registered for : Tavomi Rekasu`) → `${scope}_${headerField}`
  headerField?: string;
  // extract an `<addr@host>` (or bare email) from the header value → `${scope}_${headerEmail}`
  // (za.net writes `Administrative Contact : Tavomi Rekasu <tavomi@example.net>`)
  headerEmail?: string;
  // ordered slots for the bare body lines
  lines: PositionalSlot[];
};

export type WhoisFormat = {
  name: string;
  tokenizer?: TokenizerOptions;
  aliases: AliasTable;
  // anchored regex sources per meta state, tried against the whole normalized response
  meta?: Partial<Record<MetaKind, string[]>>;

  // ── scoped role resolution (only for block-label / handle-ref formats) ──
  roleResolution?: RoleResolution; // default 'key-prefix' (icann/generic-kv/cocca)
  // block-label: normalized section header → scope prefix. `Registrant:` → 'registrant'.
  blockScopes?: Record<string, ScopePrefix>;
  // block-label: normalized section header → a whole-block canonical field, for sections
  // whose body is a bare value or list. `Name servers:` → 'nameservers', `Domain:` →
  // 'domainName'.
  blockFields?: Record<string, string>;
  // block-label/handle-ref: subfield suffix → source keys, resolved to `${scope}_${suffix}`
  // inside a scoped block. `{ email: ['e-mail', 'Email'] }` → `registrantEmail` under a
  // registrant block.
  scopeAliases?: AliasTable;
  // block-label: when an enumerated header carries a value on its own line
  // (`Registrant: <name>`, `Domain registrant: <handle>`), the subfield suffix that value maps
  // to inside the block — `name` (rnids) or `id` (sk-nic). Unset ⇒ a header value is dropped.
  headerValueSuffix?: string;
  // handle-ref: domain/nsset-block keys that reference a contact by handle → the role that
  // reference confers. `{ 'holder-c': 'registrant', 'admin-c': 'admin', 'tech-c': 'tech' }`.
  // The object form limits which subfield suffixes the reference pulls from the contact
  // block (`{ 'owner-c': { role: 'registrant', fields: ['email'] } }` — registro.br banks
  // the registrant's name/id from the flat domain block, and only the e-mail comes from the
  // referenced contact). A filtered ref also skips banking the handle as `${role}_id`
  // unless 'id' is listed.
  handleRefs?: Record<string, ContactRole | HandleRef>;
  // handle-ref: the key whose value is a contact block's OWN handle (`nic-hdl` / `contact`).
  handleKey?: string;
  // block-label: normalized section header → a POSITIONAL template, for sections whose
  // body is bare, keyless lines mapped by position. Takes precedence over blockScopes/
  // blockFields for that header.
  positionalTemplates?: Record<string, PositionalTemplate>;
  // handle-ref: the leading key that identifies a standalone REGISTRAR object — a
  // non-contact block whose first entry is this key (AFNIC's `registrar:` block carrying
  // `address`/`country`/`phone`/`fax-no`/`e-mail`/`website`). Its fields are scoped to the
  // `registrar` role via scopeAliases, the same way a contact block is scoped by its handle.
  // Without this the registrar's address/phone/email drop (handle-ref maps only domain-level
  // aliases on non-contact blocks). The domain block starts with `domain:`, contact blocks
  // with the handleKey, so a leading `registrar:` uniquely names the registrar object.
  registrarBlockKey?: string;

  // VALUE-EXTRACT escape hatch: field → `[pattern,
  // replacement]` applied as `value.replace(new RegExp(pattern), replacement)` on the mapped
  // value before the base formatter runs. The deliberate, narrow home for the value-transforms
  // the old regexes did that a key/position alias cannot express — a date inside a phrase
  // (`Record created on 2000-08-29 …` → `2000-08-29`), an ordinal (`02nd August` → `02 August`),
  // a url in parens (`Whois Corp.(http://…)` → the url), a `Tel. `/`- ` prefix to strip.
  // Per-field, reviewable, applied to scalars and to each element of an array field. Used
  // sparingly; NOT a return to whole-text regex parsing.
  valueExtract?: Record<string, [string, string]>;

  // STRICT SCOPING (per-server): inside a block that RESOLVED to a scope, an entry whose
  // key isn't a scoped subfield goes to drift instead of falling through to the format's
  // global aliases. For registries whose contact blocks carry their own domain-shaped keys —
  // ua's contact objects each have `created:`/`status:`/`source:` that would otherwise
  // clobber (or append to) the domain's creationDate/status. Off by default: the fallback is
  // how a domain-level line inside a labeled section maps at all (za.net, kg).
  scopeStrict?: boolean;

  // RAW-TEXT PRE-PASS (per-server): rewrite a lexical quirk
  // the tokenizer can't express before tokenizing — ua's `% Registrant:` comment-headers become
  // real section headers. detectMeta and regexFields still see the TRUE raw, so meta patterns
  // and bridge rules authored against real responses keep matching.
  preprocess?: (raw: string) => string;

  // REGEX-FIELDS bridge (per-server): field → regex applied to the raw text, overriding
  // the block-mapped value for that field when it matches: flags `gm`, first non-empty
  // capture group per match, trim, case-insensitive dedup, array fields keep every match.
  // This is for servers whose format the block engine can't express yet; replace a server's
  // rules with native config when it earns the work. Not-found and throttle patterns do not
  // go here: they live on the format and in server-meta.ts.
  regexFields?: Record<string, string>;

  // states that run only the format's and the server's own patterns, not icann's
  ownMetaOnly?: MetaKind[];

  // per-format formatter options (base.ts formatters read these) — e.g. fred writes
  // day-first `21.07.2000` dates, so it sets `{ dayFirst: true }`.
  options?: ParserOptions;
};
