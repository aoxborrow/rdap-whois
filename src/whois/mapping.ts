// Pass 2 of the format-based parser: blocks → fields.
//
// Canonical field extraction is DATA, not regexes: alias tables mapping source key →
// canonical field, resolved per-server → per-format → global (resolveFormat in formats.ts
// folds a server's own spellings into its format before this file sees it).
//
// What this file deliberately does NOT own: formatters and date parsing. The mapped values
// go through the base.ts formatters and sortFields, so how a value is cleaned up is the
// same whichever format extracted it.
import {
  ARRAY_FIELDS,
  QUERY_TYPE_FIELDS,
  baseParser,
  formatFields,
  getRequiredFields,
  sortFields,
} from './base';
import {
  allEntries,
  tokenize,
  type ContactRole,
  type WhoisBlock,
  type WhoisBlocks,
  type WhoisEntry,
} from './blocks';
import {
  resolveFormat,
  metaPatterns,
  GATING_META,
  type FormatName,
  type MetaKind,
  type ScopePrefix,
  type PositionalTemplate,
  type WhoisFormat,
} from './formats';
import { SERVER_META } from './server-meta';
import { normalizeServer } from '../common/utils';
import { isEmpty } from '../common/values';
import { DOMAIN_QUERY_TYPE } from '../common/constants';
import { resolveServerAlias } from './constants';
import type { WhoisDataBag, WhoisDataType, WhoisQueryType } from './data-types';
import { scopedField } from './fields';
import { normalizeRawText } from './raw-text';
import { parseWhoisDnssecValue } from './utils';
import { compilePattern } from './regex';

const META_KINDS: MetaKind[] = ['notfound', 'throttled', 'reserved', 'servfail'];

// what a response amounts to as a whole: a record, the server saying it has none, a name it
// withholds, a throttle page, or an error message of the server's own
export type WhoisParseStatus = 'found' | 'notfound' | 'reserved' | 'throttled' | 'error';

export type MappedResult = {
  data: WhoisDataType;
  status: WhoisParseStatus;
  // (key, value) pairs the server sent that no alias claimed: "keys we don't understand".
  // The drift signal: a far better sign that a server changed its format than a field
  // going null.
  unmapped: WhoisEntry[];
  blocks: WhoisBlocks;
};

// Keys are matched case-insensitively and with trailing dot-padding stripped: the `.ax`
// registry writes `domain...............: value`, and plenty of servers vary the
// case of `Registrar WHOIS Server`. Doing this once at lookup time beats an alias entry
// per spelling.
export function normalizeKey(key: string): string {
  return key
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// meta detection: format-level ANCHORED patterns, rather than an over-broad substring match.
// Returns the matched line as evidence.
export function detectMeta(
  raw: string,
  format: WhoisFormat,
  server?: string
): Partial<Record<MetaKind, string>> {
  const text = normalizeRawText(raw);
  const found: Partial<Record<MetaKind, string>> = {};
  // per-server rules (server-meta.ts) — scoped to ONE server each, so they don't bring back
  // blanket prose matching (a global "not found" alternation false-positives on disclaimer
  // boilerplate, which the anchored patterns avoid). Renamed hostnames resolve to their
  // current name first, as in formatConfig().
  const serverMeta = server ? SERVER_META[resolveServerAlias(normalizeServer(server))] : undefined;
  for (const kind of META_KINDS) {
    const serverRule = serverMeta?.[kind];
    const patterns = [...metaPatterns(format, kind), ...(serverRule ? [serverRule] : [])];
    for (const pattern of patterns) {
      const match = compilePattern(pattern, 'm').exec(text);
      if (match) {
        found[kind] = match[0].trim();
        break;
      }
    }
  }
  return found;
}

// invert an alias table into a lookup: normalized source key → [canonical fields, in the
// order the tables declare them]. Built per call; formats are small, and a derived format
// with a server's own spellings needs its own lookup anyway.
//
// Fields are DE-DUPED per key: alias lists may legitimately contain spellings that
// normalize to the same key (`Domain Name` / `Domain name`, `nserver` / `Nserver`), and
// without this the same entry would be applied to the same field twice — appending an
// array field's value twice, and reporting the second application as drift.
function buildLookup(format: WhoisFormat): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const [field, keys] of Object.entries(format.aliases)) {
    for (const key of keys) {
      const normalized = normalizeKey(key);
      const fields = lookup.get(normalized) ?? [];
      if (!fields.includes(field)) fields.push(field);
      lookup.set(normalized, fields);
    }
  }
  return lookup;
}

// A folded continuation (blocks.ts) arrives as a "\n"-joined value. Hand it to the
// formatters as one value PER LINE rather than as one glued string: base.ts's
// singleFormatter already takes the first element of an array, and addressFormatter
// already splits addresses across lines. So the array form makes both cases right —
// a wrapped street address keeps every line, while a single-value field takes the first
// line and ignores the rest.
//
// This is what keeps folding safe. Two live examples the corpus caught: `.gh` writes a
// bare `Additional Section` header under `DNSSEC: unsigned`, and `.moscow` continues
// `Registrar Abuse Contact Phone:` onto a second bare line. Glued, both corrupt the
// field; per-line, both resolve to the first line, which is the value. (Recognizing a
// bare section header as a block boundary rather than a continuation is a format
// concern — the labeled-blocks family.)
function foldedValue(value: string): string | string[] {
  return value.includes('\n') ? value.split('\n') : value;
}

// alias priority for a field: the index of the source key in the field's alias list.
// Lower wins (the collision rule — first alias present wins).
function aliasRank(format: WhoisFormat, field: string, key: string): number {
  const index = format.aliases[field]?.findIndex(
    alias => normalizeKey(alias) === normalizeKey(key)
  );
  return index === undefined || index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

// The running state of a mapping pass: the extracted fields plus the collision bookkeeping.
// Shared by all three role-resolution strategies so the collision rule (first alias
// present wins; the displaced value stays visible as drift) behaves identically whether a
// field was reached by key prefix, block label, or handle reference.
type Accumulator = {
  parsed: WhoisDataBag;
  unmapped: WhoisEntry[];
  // the winning alias rank + the entry that set it, per single-value field. Tracking the
  // entry (not just the rank) is what lets a displaced value be reported as the LOSER: a
  // later-but-better-ranked alias can displace an earlier one (`Registrar Registration
  // Expiration Date` before `Registry Expiry Date` must not win), and the displaced entry
  // is the one that belongs in the drift set, not the winner.
  rank: Record<string, number>;
  winner: Record<string, WhoisEntry>;
};

function newAccumulator(): Accumulator {
  return { parsed: {}, unmapped: [], rank: {}, winner: {} };
}

// Apply one (field, entry) assignment under the collision rule. `entryRank` orders
// competing aliases for the SAME field (lower wins); scoped strategies pass the key's rank
// within its suffix's alias list, so a merged per-server spelling outranks a base one.
function assign(acc: Accumulator, field: string, entry: WhoisEntry, entryRank: number): void {
  if (!entry.value) return; // key understood, no value — not drift, nothing to store
  if (ARRAY_FIELDS.includes(field)) {
    // repeated keys are preserved in order — `Name Server:` × 4, `address:` × 3. The
    // value is pushed raw; a folded continuation stays `\n`-joined and the array/address
    // formatter splits it (base.ts), exactly as for a flat format.
    const existing = (acc.parsed[field] as string[] | undefined) ?? [];
    acc.parsed[field] = [...existing, entry.value];
    return;
  }
  if (!(field in acc.parsed) || entryRank < (acc.rank[field] ?? Number.MAX_SAFE_INTEGER)) {
    if (field in acc.parsed && acc.winner[field]) acc.unmapped.push(acc.winner[field]);
    acc.parsed[field] = foldedValue(entry.value);
    acc.rank[field] = entryRank;
    acc.winner[field] = entry;
  } else {
    acc.unmapped.push(entry);
  }
}

// STRATEGY 'key-prefix' (icann/generic-kv/cocca): the role lives in the key, so every
// entry is looked up flat against the format's alias table.
function mapByKeyPrefix(acc: Accumulator, blocks: WhoisBlocks, format: WhoisFormat): void {
  const lookup = buildLookup(format);
  for (const entry of allEntries(blocks)) {
    const fields = lookup.get(normalizeKey(entry.key));
    if (!fields?.length) {
      if (entry.value) acc.unmapped.push(entry);
      continue;
    }
    for (const field of fields) assign(acc, field, entry, aliasRank(format, field, entry.key));
  }
}

// invert scopeAliases (suffix → keys) into normalized key → suffix + the key's rank within
// the suffix's alias list, so a role-less key inside a scoped block resolves to
// scopedField(scope, suffix) under the same collision rule as flat aliases. The rank matters
// once deriveFormat MERGES per-server scope spellings ahead of the base table: ua's
// `person-loc` (config, rank 0) must beat the base `person` spelling (appended after) even
// when the server prints the placeholder `person: n/a` line first.
function buildScopeLookup(format: WhoisFormat): Map<string, { suffix: string; rank: number }> {
  const lookup = new Map<string, { suffix: string; rank: number }>();
  for (const [suffix, keys] of Object.entries(format.scopeAliases ?? {})) {
    keys.forEach((key, rank) => {
      if (!lookup.has(normalizeKey(key))) lookup.set(normalizeKey(key), { suffix, rank });
    });
  }
  return lookup;
}

// Map a single scoped block: its entries resolve against the scope first (`Email` under a
// registrant block → registrantEmail), then fall back to the format's global aliases
// (a date or status line that appears inside a section). A keyless bare value maps to the
// block's whole-block field, or to scopedField(scope, 'name') when the section is a contact with no
// explicit name key (eurid's `Registrant:` → `NOT DISCLOSED!`).
function mapScopedBlock(
  acc: Accumulator,
  block: WhoisBlock,
  scope: ScopePrefix | undefined,
  field: string | undefined,
  scopeLookup: Map<string, { suffix: string; rank: number }>,
  globalLookup: Map<string, string[]>,
  format: WhoisFormat,
  // the handle key (`contact` / `nic-hdl`) identifies the block, not a name — skip it so it
  // doesn't collide with the scope's `name` alias (fred's `contact:` also spells `name`).
  skipKey?: string,
  // force strict scoping for THIS block regardless of format.scopeStrict — handle-ref
  // contact blocks pass true (their created:/changed:/eppstatus: lines describe the
  // CONTACT object, and the global fallback would append them to domain status/dates)
  strict?: boolean,
  // subfield-suffix allowlist from a FIELD-FILTERED handle ref (types.ts HandleRef): only
  // these suffixes assign; everything else is skipped silently — the block's full mapping
  // belongs to its unfiltered role
  fields?: string[]
): void {
  for (const entry of block.entries) {
    if (skipKey && normalizeKey(entry.key) === skipKey) continue;
    if (!entry.key) {
      // bare value line. A `+`-joined blockField target fans the one line to several fields
      // (CIDR's `Gandi SAS (http://www.gandi.net)` → registrarName + registrarUrl, then
      // value-extract trims each); a plain target assigns once.
      if (fields && !fields.includes('name')) continue;
      const target = field ?? (scope ? scopedField(scope, 'name') : undefined);
      if (target) for (const t of target.split('+')) assign(acc, t, entry, 0);
      else if (entry.value) acc.unmapped.push(entry);
      continue;
    }
    const scoped = scope ? scopeLookup.get(normalizeKey(entry.key)) : undefined;
    if (scope && scoped) {
      if (fields && !fields.includes(scoped.suffix)) continue;
      assign(acc, scopedField(scope, scoped.suffix), entry, scoped.rank);
      continue;
    }
    // a filtered pass never falls through to strict-unmapped or global aliases
    if (fields) continue;
    // STRICT SCOPING: inside a scoped block an unrecognized key drifts rather than
    // falling through — ua's contact objects carry their own created:/status:/source: that
    // would clobber (or append to) the domain-level fields.
    if (scope && (strict ?? format.scopeStrict)) {
      if (entry.value) acc.unmapped.push(entry);
      continue;
    }
    // not a scoped subfield — try the format's global (domain-level) aliases
    const globals = globalLookup.get(normalizeKey(entry.key));
    if (globals?.length) {
      for (const g of globals) assign(acc, g, entry, aliasRank(format, g, entry.key));
    } else if (entry.value) {
      acc.unmapped.push(entry);
    }
  }
}

// Does a bare line look like an email / phone / country? (positional shape-matching).
// Deliberately conservative — only shapes that can't be confused with a name/city/street:
// an email always has `@`; a phone starts with `+` or is mostly punctuated digits.
const EMAIL_SHAPE = /\S+@\S+\.\S+/;
// a phone line, optionally prefixed with a `Tel:`/`Phone:`/`Fax:` label the value-extract strips
const PHONE_SHAPE = /^(?:(?:tel|phone|fax)[.:]?\s*)?\+[\d][\d\s().+-]{4,}$/i;
const URL_SHAPE = /^https?:\/\/\S+$/i;
function matchesShape(value: string, shape: 'email' | 'phone' | 'country' | 'url'): boolean {
  if (shape === 'email') return EMAIL_SHAPE.test(value);
  if (shape === 'phone') return PHONE_SHAPE.test(value);
  if (shape === 'url') return URL_SHAPE.test(value);
  // country: a bare 2-letter ISO code — the only country form ccTLD whois writes positionally.
  // Kept STRICT (no loose "short all-letters line" fallback) so it can't be confused with an
  // org/name line: twnic prints `Registrant → <chinese name>, <english org>, <email>, TW` and a
  // loose matcher would pull the English org as the country before the real `TW`.
  return /^[A-Z]{2}$/.test(value);
}

// Map a POSITIONAL block: the header may carry the first datum(s), and the body is bare
// lines assigned by position — shape-matched slots (email/phone) pulled out first so a
// missing/extra earlier line can't shift them, then the plain slots filled in document order.
function mapPositionalBlock(
  acc: Accumulator,
  block: WhoisBlock,
  tmpl: PositionalTemplate,
  scopeLookup: Map<string, { suffix: string; rank: number }>,
  globalLookup: Map<string, string[]>,
  format: WhoisFormat
): void {
  const scope = tmpl.scope;
  if (scope !== 'registrar') block.role = scope;

  // KEYED entries inside a positional block are either scoped sub-fields (nic.sm writes bare
  // name/address lines THEN keyed `Phone:`/`Email:`) or a domain-level line the tokenizer
  // folded in (za.net's trailing `Record Created:`). Resolve scope sub-field first, then the
  // format's global aliases — same order as a scoped block.
  for (const entry of block.entries) {
    if (!entry.key) continue;
    const scoped = scopeLookup.get(normalizeKey(entry.key));
    if (scoped) {
      assign(acc, scopedField(scope, scoped.suffix), entry, scoped.rank);
      continue;
    }
    const globals = globalLookup.get(normalizeKey(entry.key));
    if (globals?.length) {
      for (const g of globals) assign(acc, g, entry, aliasRank(format, g, entry.key));
    } else if (entry.value) {
      acc.unmapped.push(entry);
    }
  }

  // 1) the header line's own value (name, optionally with an `<email>`)
  if (block.labelValue) {
    let headerValue = block.labelValue;
    if (tmpl.headerEmail) {
      const m = headerValue.match(/<([^<>@]+@[^<>]+)>/) ?? headerValue.match(/(\S+@\S+\.\S+)/);
      if (m) {
        assign(acc, scopedField(scope, tmpl.headerEmail), { key: '', value: m[1], line: 0 }, 0);
        headerValue = headerValue.replace(m[0], '').trim();
      }
    }
    if (tmpl.headerField && headerValue) {
      assign(
        acc,
        scopedField(scope, tmpl.headerField),
        { key: '', value: headerValue, line: 0 },
        0
      );
    }
  }

  // 2) the bare body lines (keyless entries the tokenizer captured under this header)
  const lines = block.entries.filter(e => !e.key && e.value).map(e => e.value);
  const used = new Set<number>();
  // shape-matched slots first (position-free)
  for (const slot of tmpl.lines) {
    if (typeof slot !== 'object' || !('match' in slot)) continue;
    const idx = lines.findIndex((v, i) => !used.has(i) && matchesShape(v, slot.match));
    if (idx >= 0) {
      used.add(idx);
      assign(acc, scopedField(scope, slot.field), { key: '', value: lines[idx], line: 0 }, 0);
    }
  }
  // plain + skip slots over the remaining lines, in order
  const remaining = lines.map((v, i) => ({ v, i })).filter(x => !used.has(x.i));
  let cursor = 0;
  for (const slot of tmpl.lines) {
    if (typeof slot === 'object' && 'match' in slot) continue; // already placed
    const cell = remaining[cursor++];
    if (!cell) break;
    if (typeof slot === 'string') {
      // a `name+org` slot fans one line to several fields — used where a server puts a name on
      // that line for one domain and an organisation for another (nic.net.sa), so the line
      // goes to both.
      for (const field of slot.split('+')) {
        assign(acc, scopedField(scope, field), { key: '', value: cell.v, line: 0 }, 0);
      }
    }
    // { skip: true } → consume the line, assign nothing
  }
}

// STRATEGY 'block-label' (labeled-blocks: eurid, nominet, …): the section header names the
// scope or field; entries under it are role-less.
function mapByBlockLabel(acc: Accumulator, blocks: WhoisBlocks, format: WhoisFormat): void {
  const scopeLookup = buildScopeLookup(format);
  const globalLookup = buildLookup(format);
  for (const block of blocks.blocks) {
    const label = block.label ? normalizeKey(block.label) : undefined;
    // a positional template fully owns its block — bare lines by position
    const tmpl = label ? format.positionalTemplates?.[label] : undefined;
    if (tmpl) {
      mapPositionalBlock(acc, block, tmpl, scopeLookup, globalLookup, format);
      continue;
    }
    const scope = label ? format.blockScopes?.[label] : undefined;
    const field = label ? format.blockFields?.[label] : undefined;
    if (scope && scope !== 'registrar') block.role = scope;
    // a value carried on the header line itself (`Registrant: <name>`) → scopedField(scope, suffix)
    if (block.labelValue && scope && format.headerValueSuffix) {
      const entry = { key: '', value: block.labelValue, line: 0 };
      assign(acc, scopedField(scope, format.headerValueSuffix), entry, 0);
    }
    mapScopedBlock(acc, block, scope, field, scopeLookup, globalLookup, format);
  }
}

// STRATEGY 'handle-ref' (rpsl: AFNIC/RIPE-db, fred: CZ.NIC): the domain (and nsset) blocks
// reference contacts by handle; separate contact blocks are keyed by that handle. Roles are
// resolved by matching the two.
//
// The format's `aliases` are deliberately DOMAIN-LEVEL ONLY here (no bare `address`/`phone`
// that would otherwise mis-file a registrar block's address as the registrant's) — every
// contact field comes from a role-scoped contact block, never from a flat global match.
function mapByHandleRef(acc: Accumulator, blocks: WhoisBlocks, format: WhoisFormat): void {
  const scopeLookup = buildScopeLookup(format);
  const globalLookup = buildLookup(format);
  const handleRefs = format.handleRefs ?? {};
  const handleKey = format.handleKey ? normalizeKey(format.handleKey) : undefined;
  // normalize a reference to its object form (types.ts HandleRef; a bare role = unfiltered)
  const refFor = (key: string): { role: ContactRole; fields?: string[] } | undefined => {
    const ref = handleRefs[normalizeKey(key)];
    return typeof ref === 'string' ? { role: ref } : ref;
  };

  // pass A — collect handle → roles from reference keys anywhere (a tech-c can live in an
  // nsset block, not just the domain block), and bank the reference itself as scopedField(role, 'id').
  // a field-filtered ref only pulls its listed suffixes, so an unfiltered ref for the same
  // role wins (undefined = everything); the handle is banked as scopedField(role, 'id') only when
  // unfiltered or when 'id' is listed.
  const rolesByHandle = new Map<string, Map<ContactRole, string[] | undefined>>();
  for (const block of blocks.blocks) {
    for (const entry of block.entries) {
      const ref = refFor(entry.key);
      if (!ref || !entry.value) continue;
      const handle = entry.value.trim();
      const roles = rolesByHandle.get(handle) ?? rolesByHandle.set(handle, new Map()).get(handle)!;
      if (!ref.fields || !roles.has(ref.role)) roles.set(ref.role, ref.fields);
      if (!ref.fields || ref.fields.includes('id'))
        assign(acc, scopedField(ref.role, 'id'), entry, 0);
    }
  }

  // pass B — map each block. A contact block (one carrying the handleKey) is scoped to every
  // role its handle was referenced under; other blocks map via the domain-level aliases.
  for (const block of blocks.blocks) {
    const handleEntry = handleKey
      ? block.entries.find(e => normalizeKey(e.key) === handleKey)
      : undefined;
    const roles = handleEntry?.value ? rolesByHandle.get(handleEntry.value.trim()) : undefined;
    if (roles?.size) {
      for (const [role, fields] of roles) {
        // a filtered ref pulls a few fields from a block that (usually) belongs to another
        // role — leave the display role to the unfiltered reference
        if (!fields) block.role = role; // last wins for display; every role still gets its fields
        // STRICT: a contact block's keys resolve through scopeAliases ONLY. Its own
        // eppstatus:/changed:/created: lines describe the contact object — the global
        // fallback would append AFNIC's `eppstatus: associated` to the DOMAIN status and
        // file a FRED contact's `changed:` as updatedDate (PR #371 review finding).
        mapScopedBlock(
          acc,
          block,
          role,
          undefined,
          scopeLookup,
          globalLookup,
          format,
          handleKey,
          true,
          fields
        );
      }
      continue;
    }
    // a standalone registrar object (leading key = registrarBlockKey): scope it to the
    // registrar role so its address/phone/fax/email/website land via scopeAliases. Its
    // leading `registrar:` still resolves to registrarName through the global aliases.
    const regKey = format.registrarBlockKey ? normalizeKey(format.registrarBlockKey) : undefined;
    if (regKey && normalizeKey(block.entries[0]?.key ?? '') === regKey) {
      mapScopedBlock(acc, block, 'registrar', undefined, scopeLookup, globalLookup, format);
      continue;
    }
    // non-contact block (domain, nserver, key): domain-level aliases only, and
    // reference keys are consumed as ids above — don't also map them as flat fields.
    for (const entry of block.entries) {
      if (handleRefs[normalizeKey(entry.key)]) continue;
      const globals = globalLookup.get(normalizeKey(entry.key));
      if (globals?.length) {
        for (const g of globals) assign(acc, g, entry, aliasRank(format, g, entry.key));
      } else if (entry.value && entry.key) {
        acc.unmapped.push(entry);
      }
    }
  }
}

// Map tokenized blocks onto canonical fields, dispatching on the format's role-resolution
// strategy. Returns the extracted fields and the drift set.
export function mapEntries(
  blocks: WhoisBlocks,
  format: WhoisFormat
): { parsed: WhoisDataBag; unmapped: WhoisEntry[] } {
  const acc = newAccumulator();
  switch (format.roleResolution ?? 'key-prefix') {
    case 'block-label':
      mapByBlockLabel(acc, blocks, format);
      break;
    case 'handle-ref':
      mapByHandleRef(acc, blocks, format);
      break;
    default:
      mapByKeyPrefix(acc, blocks, format);
  }
  return { parsed: acc.parsed, unmapped: acc.unmapped };
}

// Apply the format's valueExtract regexes in place. Group 1 replaces the value; a
// non-match leaves the value untouched (so a field the transform doesn't apply to survives).
function applyValueExtract(parsed: WhoisDataBag, format: WhoisFormat): void {
  if (!format.valueExtract) return;
  for (const [field, [pattern, replacement]] of Object.entries(format.valueExtract)) {
    const re = compilePattern(pattern);
    const value = parsed[field];
    const extract = (v: string): string => v.replace(re, replacement);
    if (typeof value === 'string') parsed[field] = extract(value);
    else if (Array.isArray(value)) parsed[field] = value.map(extract);
  }
}

// Run one regex-fields rule: flags `gm`, the FIRST non-undefined capture group per match, trimmed, deduped
// case-insensitively; every match is kept (the caller decides array vs first).
function parseRegexField(pattern: string, text: string): string[] {
  if (!pattern) return [];
  const regExp = compilePattern(pattern, 'gm');
  const matches: string[] = [];
  let captures;
  while ((captures = regExp.exec(text)) !== null) {
    let capture: string | null = null;
    for (let i = 1; i < captures.length; i++) {
      if (captures[i] !== undefined) {
        capture = captures[i];
        break;
      }
    }
    const value = typeof capture === 'string' ? capture.trim() : capture;
    if (value && !matches.some(v => v.toLowerCase() === value.toLowerCase())) {
      matches.push(value);
    }
  }
  return matches;
}

// Apply the format's regexFields bridge rules over the raw text: a rule that MATCHES
// overrides the block-mapped value for its field (the rule exists because the block engine
// can't express that field yet); a miss leaves the block value in place, so a lift the block
// engine finds on some other domain survives. Array fields keep every match — multi-line
// captures (an NS block) are formatted by the same base.ts formatters downstream.
function applyRegexFields(parsed: WhoisDataBag, text: string, format: WhoisFormat): void {
  if (!format.regexFields) return;
  for (const [field, pattern] of Object.entries(format.regexFields)) {
    const matches = parseRegexField(pattern, text);
    if (!matches.length) continue;
    parsed[field] = ARRAY_FIELDS.includes(field) ? matches : matches[0];
  }
}

// Parse a raw whois response: the status it amounts to, the fields, and what was left
// unmapped.
export function parseBlocks(
  raw: string,
  server: string,
  queryType: WhoisQueryType,
  // a format NAME resolves through resolveFormat; a derived WhoisFormat object is used as-is
  // (the test seam for exercising a synthetic per-server config end-to-end)
  formatName?: FormatName | WhoisFormat
): MappedResult {
  // per-server config → explicit name → default
  const format = typeof formatName === 'object' ? formatName : resolveFormat(server, formatName);
  // preprocess feeds ONLY the tokenizer — meta detection and regexFields run on the
  // true raw, so patterns authored against real responses keep matching
  const blocks = tokenize(format.preprocess ? format.preprocess(raw) : raw, format.tokenizer);
  const meta = detectMeta(raw, format, server);

  // META GATES MAPPING: a throttled/servfail response is an error page, and an
  // error page never yields data fields. Short-circuit before extraction so it can't
  // resolve to "available" or to a garbage-parsed "registered".
  const gated = GATING_META.some(kind => kind in meta);
  const { parsed, unmapped } = gated
    ? { parsed: {} as WhoisDataBag, unmapped: [] }
    : mapEntries(blocks, format);

  // VALUE-EXTRACT: pull capture group 1 out of a mapped value before formatting — the
  // narrow escape hatch for value-transforms a key/position alias can't express (a date inside
  // a phrase, a url in parens, a `Tel. ` prefix). Scalars and each element of an array field.
  applyValueExtract(parsed, format);

  // REGEX-FIELDS bridge, after valueExtract so a matched rule's value wins untouched.
  // Runs on the same normalized text the tokenizer reads.
  if (!gated) applyRegexFields(parsed, normalizeRawText(raw), format);

  // post-processing: base.ts formatters, every field of the query type present, and the
  // field order. A format
  // may supply parser options (fred writes day-first `21.07.2000` dates) that the base.ts
  // formatters read.
  const parser = { ...baseParser, options: { ...baseParser.options, ...format.options } };
  // the query type's required fields start as null, so their formatters run on them too
  let data: WhoisDataBag = {
    ...Object.fromEntries(getRequiredFields(queryType).map(field => [field, null])),
    ...parsed,
  };
  // eppStatusRaw is DERIVED, not mapped: no alias points at it, and a formatter gets one
  // field in and one field out, so the split has to happen here. It has to happen BEFORE
  // formatFields too, which overwrites data[field] in place — by the time statusFormatter
  // runs, arrayFormatter has already stripped brackets, split on commas, deduped
  // case-insensitively and sorted, so there is nothing pre-normalization left to copy
  if (queryType === DOMAIN_QUERY_TYPE && !isEmpty(data.eppStatus)) {
    data.eppStatusRaw = data.eppStatus;
  }
  data = formatFields(parser, data, queryType);
  data = sortFields(completeData(data, queryType));

  return { data: data as unknown as WhoisDataType, status: parseStatus(meta), unmapped, blocks };
}

// one verdict from the states that matched. A throttle page carries nothing else worth
// reading, and a server's not-found outranks the error wording some put beside it
export function parseStatus(meta: Partial<Record<MetaKind, string>>): WhoisParseStatus {
  if (meta.throttled) return 'throttled';
  if (meta.notfound) return 'notfound';
  if (meta.servfail) return 'error';
  if (meta.reserved) return 'reserved';
  return 'found';
}

// The parsed data in its one shape: every field of the query type present, and null wherever
// the response gave nothing, an empty list included. DNSSEC and the registrar's IANA ID are
// typed as in the domain record, with the DNSSEC text kept as the server wrote it
function completeData(data: WhoisDataBag, queryType: WhoisQueryType): WhoisDataBag {
  const out: WhoisDataBag = Object.fromEntries(
    (QUERY_TYPE_FIELDS[queryType] ?? []).map(field => [field, null])
  );
  for (const [field, value] of Object.entries(data)) {
    out[field] =
      value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
        ? null
        : value;
  }
  if (queryType === DOMAIN_QUERY_TYPE) {
    const dnssec = typeof out.dnssec === 'string' ? out.dnssec : null;
    out.dnssec = parseWhoisDnssecValue(dnssec);
    out.dnssecRaw = dnssec;
    const registrarId = typeof out.registrarId === 'string' ? out.registrarId : null;
    out.registrarIanaId =
      registrarId && /^\d+$/.test(registrarId) ? parseInt(registrarId, 10) : null;
  }
  return out;
}
