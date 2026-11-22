// Format registry + resolution. The ./formats/
// directory holds ONLY the format files — one WhoisFormat per operator/software family —
// and this file assembles them: the registry, deriveFormat (a ./servers/ config
// layered onto its base format), and the per-server resolution order. The naming insight:
// response shape follows the registry OPERATOR or SOFTWARE, not the TLD, so one format
// covers many servers.
import { FORMAT_CONFIGS } from './generated/servers';
import type { ContactRole } from './blocks';
import { normalizeServer } from '../common/utils';
import { resolveServerAlias } from './constants';
import type { ParserOptions } from './data-types';
import { mergeAliases } from './aliases';
import { blockScopedFormat } from './formats/block-scoped';
import { coccaFormat } from './formats/cocca';
import { fredFormat } from './formats/fred';
import { genericKvFormat } from './formats/generic-kv';
import { icannFormat } from './formats/icann';
import { kaznicFormat } from './formats/kaznic';
import { labeledBlocksFormat } from './formats/labeled-blocks';
import { rpslFormat } from './formats/rpsl';
import type {
  AliasTable,
  HandleRef,
  MetaKind,
  PositionalTemplate,
  ScopePrefix,
  WhoisFormat,
} from './types';

export * from './types';
export { icannFormat, ICANN_ALIASES } from './formats/icann';
export { genericKvFormat, GENERIC_KV_ALIASES } from './formats/generic-kv';
export { coccaFormat } from './formats/cocca';
export { labeledBlocksFormat } from './formats/labeled-blocks';
export { rpslFormat } from './formats/rpsl';
export { fredFormat } from './formats/fred';
export { kaznicFormat } from './formats/kaznic';
export { blockScopedFormat } from './formats/block-scoped';

export const FORMATS = {
  'icann': icannFormat,
  'generic-kv': genericKvFormat,
  // operator/software formats, found by clustering responses by their shape
  'cocca': coccaFormat,
  'labeled-blocks': labeledBlocksFormat,
  'rpsl': rpslFormat,
  'fred': fredFormat,
  // colon-less/bracket-header block-label formats: kaznic (own file, predates the base),
  // block-scoped (reusable base — new members are data-only per-server configs)
  'kaznic': kaznicFormat,
  'block-scoped': blockScopedFormat,
} as const;

export type FormatName = keyof typeof FORMATS;

export const DEFAULT_FORMAT: FormatName = 'generic-kv';

export function getFormat(name: FormatName = DEFAULT_FORMAT): WhoisFormat {
  return FORMATS[name];
}

// The per-server config shape. It is NOT a format: it PICKS a base
// format (`format: FormatName`) and layers server-specific spellings/section-labels/options on
// top; deriveFormat (below) merges it into the WhoisFormat that mapping runs. (Named
// FormatConfig, not ServerConfig, to stop colliding with the connection-side WhoisServer that
// servers.ts's getServerConfig returns.) One file per server lives in ./servers/ as
// `export const config: FormatConfig`; the generated FORMAT_CONFIGS map assembles them. Defined
// here rather than in ./servers/ because it needs FormatName (this file) and formatConfig()/
// deriveFormat/resolveFormat form one resolution pipeline — keeping ./servers/ pure data.
export type FormatConfig = {
  format: FormatName;
  // states whose patterns are the server's own only (server-meta.ts), without the ICANN
  // spellings every other format also runs. For a server that prints an ICANN-like line
  // where it means something else
  ownMetaOnly?: MetaKind[];
  // per-server EXTRA spellings, HIGHEST priority (merged BEFORE the base format's)
  aliases?: AliasTable;
  // per-server scoped-subfield spellings (block-label / handle-ref formats)
  scopeAliases?: AliasTable;
  // per-server COLON-LESS/bracket section headers to open a block on (block-scoped base).
  // Merged into the base tokenizer's sectionHeaders by deriveFormat.
  sectionHeaders?: string[];
  // per-server key/value split override — `multispace` for column-aligned, colon-less
  // formats (JPRS, nic.md). Merged into the base tokenizer by deriveFormat.
  keyValueSplit?: 'colon' | 'multispace';
  // keep enumerated-header blocks open across blank lines — kg/bnnic write the fields a
  // blank line below the header. Off by default (blank = block boundary).
  blankLinesInBlocks?: boolean;
  // override the tokenizer's notice-line prefixes — nic.tr/trabis mark SECTION HEADERS with
  // `**`, so the default `*` prefix would drop every one as a notice. Replaces the default.
  noticePrefixes?: string[];
  // headers whose body lines are captured whole, never colon-split — CIDR bare bodies
  // that contain a url/time. Merged into the base tokenizer by deriveFormat.
  bareBodyHeaders?: string[];
  // override the base format's continuation-folding. block-scoped turns it OFF so each contact
  // datum is its own entry, but a mixed server (dns.pl: folded keyed NS list AND a bare positional
  // REGISTRAR block) needs it back ON — the bare-body section keeps its lines discrete regardless.
  foldContinuations?: boolean;
  // per-server section-header → scope / field (a registry's own section names)
  blockScopes?: Record<string, ScopePrefix>;
  blockFields?: Record<string, string>;
  // per-server POSITIONAL templates: normalized header → bare-line field order
  positionalTemplates?: Record<string, PositionalTemplate>;
  // per-server handle-ref keys, merged onto the base format's (rpsl/fred) — nic.at names its
  // registrant handle-ref `registrant:` rather than the AFNIC `holder-c:`. Object form =
  // field-filtered reference (types.ts HandleRef).
  handleRefs?: Record<string, ContactRole | HandleRef>;
  // override the base format's handle key — the key that identifies a contact block AND
  // whose value the reference keys match against (rpsl `nic-hdl`, fred `contact`). registro.br
  // is rpsl-shaped but names its handle `nic-hdl-br`, so its contact blocks resolve only with
  // this override. Replaces (does not merge with) the base key.
  handleKey?: string;
  // the subfield an enumerated header's own value maps to (`Registrant: <name>` → name)
  headerValueSuffix?: string;
  // per-field value-extract regexes — capture group 1 replaces the value before formatting
  valueExtract?: Record<string, [string, string]>;
  // strict scoping — inside a scoped block, an unrecognized key drifts instead of
  // falling through to global aliases (ua's contact blocks carry their own created:/status:).
  scopeStrict?: boolean;
  // raw-text pre-pass before tokenize — rewrite a lexical quirk the tokenizer can't
  // express (ua's `% Registrant:` comment-headers → real headers). detectMeta/regexFields
  // still see the true raw.
  preprocess?: (raw: string) => string;
  // per-field regexes over the raw text, overriding the block-mapped value on match —
  // for formats the block engine can't express yet. See WhoisFormat.regexFields.
  regexFields?: Record<string, string>;
  options?: ParserOptions;
};

// The generated filename-is-the-map registry: every servers/whois.<host>.ts contributes its
// config under that hostname. Re-exported for the test that keeps it in step with the files.
export { FORMAT_CONFIGS };

// Resolve a server to its per-server FormatConfig (undefined = no per-server config, so the
// caller falls back to the base format). A
// caller passing a renamed host (whois.dk-hostmaster.dk) must reach the canonical config
// (whois.punktum.dk), not fall back to the generic format.
export function formatConfig(server: string): FormatConfig | undefined {
  return FORMAT_CONFIGS[resolveServerAlias(normalizeServer(server))];
}

// Derive the effective WhoisFormat for a server config: the base format with the server's
// overrides layered on. Per-server aliases go FIRST so they win the collision rule;
// section-label maps and options are shallow-merged (server keys win). Lives here rather
// than in servers/ so the config side stays pure data and never imports the
// registry back (the old formats/index ↔ server-configs cycle).
export function deriveFormat(config: FormatConfig): WhoisFormat {
  const base = FORMATS[config.format];
  // per-server colon-less/bracket headers add to (never replace) the base's; a keyValueSplit
  // override replaces the base's. Only rebuild the tokenizer when the config touches it.
  const tokenizer =
    config.sectionHeaders ||
    config.keyValueSplit ||
    config.blankLinesInBlocks ||
    config.noticePrefixes ||
    config.bareBodyHeaders ||
    config.foldContinuations !== undefined
      ? {
          ...base.tokenizer,
          ...(config.sectionHeaders
            ? {
                sectionHeaders: [
                  ...(base.tokenizer?.sectionHeaders ?? []),
                  ...config.sectionHeaders,
                ],
              }
            : {}),
          ...(config.keyValueSplit ? { keyValueSplit: config.keyValueSplit } : {}),
          ...(config.blankLinesInBlocks ? { blankLinesInBlocks: true } : {}),
          ...(config.noticePrefixes ? { noticePrefixes: config.noticePrefixes } : {}),
          ...(config.bareBodyHeaders ? { bareBodyHeaders: config.bareBodyHeaders } : {}),
          ...(config.foldContinuations !== undefined
            ? { foldContinuations: config.foldContinuations }
            : {}),
        }
      : base.tokenizer;
  return {
    ...base,
    tokenizer,
    aliases: config.aliases ? mergeAliases(config.aliases, base.aliases) : base.aliases,
    // same ordered-merge rule as `aliases` (config spellings first): a config that adds one
    // `name` spelling must not silently DROP the base suffix's whole list for that server —
    // a shallow spread replaced per-suffix lists wholesale (PR #372 review finding)
    scopeAliases: config.scopeAliases
      ? mergeAliases(config.scopeAliases, base.scopeAliases ?? {})
      : base.scopeAliases,
    blockScopes: { ...base.blockScopes, ...config.blockScopes },
    blockFields: { ...base.blockFields, ...config.blockFields },
    handleRefs: config.handleRefs ? { ...base.handleRefs, ...config.handleRefs } : base.handleRefs,
    handleKey: config.handleKey ?? base.handleKey,
    positionalTemplates: { ...base.positionalTemplates, ...config.positionalTemplates },
    headerValueSuffix: config.headerValueSuffix ?? base.headerValueSuffix,
    valueExtract: { ...base.valueExtract, ...config.valueExtract },
    scopeStrict: config.scopeStrict ?? base.scopeStrict,
    preprocess: config.preprocess ?? base.preprocess,
    regexFields: { ...base.regexFields, ...config.regexFields },
    options: { ...base.options, ...config.options },
    ...(config.ownMetaOnly ? { ownMetaOnly: config.ownMetaOnly } : {}),
  };
}

// Resolve the effective format for a server (per-server → per-format → global): a
// per-server CONFIG wins outright — the config files in ./servers/ are the ONLY per-server
// source of truth, a server that only needs a format having a config naming just that —
// otherwise an explicit format name, otherwise the default. This is the single entry point
// mapping.ts uses, so per-server overrides apply everywhere the parser runs.
export function resolveFormat(server?: string, name?: FormatName): WhoisFormat {
  if (server) {
    const config = formatConfig(server);
    if (config) return deriveFormat(config);
  }
  return FORMATS[name ?? DEFAULT_FORMAT];
}

// The meta patterns a format actually runs: its own, plus icann's as a base for
// generic-kv (the ICANN spellings are near-universal even off-spec). Kept here rather
// than duplicated into the format files so the two can't drift apart.
export function metaPatterns(format: WhoisFormat, kind: MetaKind): string[] {
  const own = format.meta?.[kind] ?? [];
  if (format.name === 'icann' || format.ownMetaOnly?.includes(kind)) return own;
  return [...own, ...(icannFormat.meta?.[kind] ?? [])];
}
