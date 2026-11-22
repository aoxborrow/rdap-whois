// Pass 1 of the format-based parser: raw → blocks.
//
// Tokenizes a whois response into notices vs. data, and data into ordered blocks of
// key/value entries. This is the IR the mapping pass (mapping.ts) turns into canonical
// fields. Per-field regexes over the whole raw text are what make counted-newline hacks and
// cross-section bleed possible in the first place; blocks avoid both.
//
// The tokenizer is TOTAL: it never throws. Any line no rule claims is kept in
// `leftovers` with its line number. That is a deliberate inversion of weppos's scanners,
// which raise on the first unmatched line (a loud signal that the format changed, but the
// change becomes an outage). We keep the signal — leftovers + unmapped entries are the
// parse's drift — and drop the outage.
//
// Nothing here is whois-semantic: no field names, no roles, no canonical output. Those
// live in mapping.ts + formats/. This file only answers "what lines, what keys, what
// blocks".
import { normalizeRawText } from './raw-text';

// a contact role, resolved in pass 2 from block labels / handle refs
export type ContactRole = 'registrant' | 'admin' | 'tech' | 'billing';

export type WhoisEntry = {
  key: string;
  value: string;
  // 1-based line number in the normalized text — provenance for the drift report, and
  // what lets an override target a specific line rather than counting newlines
  line: number;
};

export type WhoisBlock = {
  label?: string;
  // the VALUE an enumerated header carried on its own line (`Registrant: Ringier Serbia doo`,
  // `Domain registrant: WY-237559`) — the header both opens the block and states one datum.
  // The mapping pass routes it to `${scope}_${headerValueSuffix}` (name for rnids, id for
  // sk-nic). Empty for the usual value-less header.
  labelValue?: string;
  role?: ContactRole; // set by the mapping pass, not the tokenizer
  entries: WhoisEntry[];
};

export type WhoisLeftover = { text: string; line: number };

export type WhoisBlocks = {
  notices: string[];
  blocks: WhoisBlock[];
  // lines claimed by no rule. Not an error — the drift signal.
  leftovers: WhoisLeftover[];
};

export type TokenizerOptions = {
  // how a labeled block header is recognized:
  //   'none'        — never; a `Key:` line with no value is an entry with an empty value
  //   'empty-value' — a `Key:` line with no value opens a labeled block
  // This is format-driven and NOT a global default because the two are lexically
  // identical: ICANN output writes `Registrar Abuse Contact Email:` with an empty value
  // for redacted fields, while ati.tn-style output writes `Owner Contact:` as a section
  // header. Only the format knows which it is. icann/generic-kv use 'none'; the
  // labeled-blocks family uses 'empty-value'.
  blockLabels?: 'none' | 'empty-value';
  // keep an enumerated-header block OPEN across blank lines: kg/bnnic write `Contact:\n\n  Name: …` and use blanks as spacing between sub-fields,
  // so a blank must NOT close the block. OFF by default — the safe behaviour is blank = block
  // boundary (za.net writes contiguous contact blocks separated by blanks, with a trailing
  // prose footer that would otherwise glue onto the last data block). Only meaningful when
  // sectionHeaders is set.
  blankLinesInBlocks?: boolean;
  // COLON-LESS section headers: a bare line with no
  // colon that names a section — KazNIC's `Organization Using Domain Name`,
  // `Administrative Contact/Agent`. Lexically indistinguishable from prose (`This server is
  // maintained by …`), so the format ENUMERATES its headers rather than the tokenizer
  // guessing; only a listed line opens a labeled block. Matched case-insensitively with
  // collapsed whitespace. Empty ⇒ off (every format but the KazNIC family).
  sectionHeaders?: string[];
  // how a `key`/`value` line is split:
  //   'colon'      — on the first colon (`Domain Name: value`). The default, ~all registries.
  //   'multispace' — on the first run of 2+ spaces (`[Domain Name]    GOOGLE.CO.JP`,
  //                  `Domain  name    999.md`). JPRS (.jp) and nic.md write column-aligned
  //                  key/value with NO colon; a colon split would drop every field.
  keyValueSplit?: 'colon' | 'multispace';
  // section headers whose BODY lines are captured WHOLE as bare values, never split on a
  // colon: CIDR (.as/.je/.gg) writes bare block bodies that
  // contain colons — a `http://` url, an `at 00:00:00` time — which the KV split would wrongly
  // tear into key/value. Listing the header here keeps the whole line as one bare value for the
  // mapping pass's blockField/positional handling.
  bareBodyHeaders?: string[];
  // fold bare continuation lines into the previous entry's value (CoCCA street addresses
  // spill across bare lines, which a line-anchored regex cannot see)
  foldContinuations?: boolean;
  // a key longer than this is prose that happens to contain a colon ("Terms of Use: ...")
  // rather than a field — the line becomes a leftover instead of a bogus entry
  maxKeyLength?: number;
  // line prefixes that mark comment/legal/notice lines rather than data
  noticePrefixes?: string[];
};

const DEFAULTS: Required<TokenizerOptions> = {
  blockLabels: 'none',
  blankLinesInBlocks: false,
  sectionHeaders: [],
  bareBodyHeaders: [],
  keyValueSplit: 'colon',
  foldContinuations: true,
  maxKeyLength: 64,
  noticePrefixes: ['%', '#', '>>>', '*'],
};

// normalize a header line / declared header for case-insensitive, whitespace-collapsed
// matching. Deliberately mirrors mapping.ts normalizeKey (minus the dot-strip, which headers
// never carry) — kept local so blocks.ts stays free of the whois-semantic mapping layer.
function normalizeHeader(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

// `Key: value` — split on the FIRST colon only, so URLs and timestamps survive in values.
// The key is captured lazily and length-checked by the caller.
const KV_LINE = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/;

// `Key    value` — column-aligned split on the first run of 2+ spaces (keyValueSplit
// 'multispace'). A single space inside a key (`Domain name`) survives; the value keeps its
// own inner spacing. A line with no 2+ space gap doesn't match and falls through.
const KV_LINE_MULTISPACE = /^\s*(.+?)\s{2,}(.+?)\s*$/;

function isNotice(line: string, prefixes: string[]): boolean {
  const trimmed = line.trimStart();
  return prefixes.some(prefix => trimmed.startsWith(prefix));
}

// Tokenize a raw whois response into WhoisBlocks. Never throws.
export function tokenize(raw: string, options: TokenizerOptions = {}): WhoisBlocks {
  const config = { ...DEFAULTS, ...options };
  const result: WhoisBlocks = { notices: [], blocks: [], leftovers: [] };

  // normalizeRawText handles \r\n → \n, tabs/exotic whitespace → space, and HTML
  // entity decoding
  const text = normalizeRawText(raw);
  if (!text) return result;

  // colon-less section headers this format declares (empty for all but the KazNIC family)
  const headerSet = new Set(config.sectionHeaders.map(normalizeHeader));
  // headers whose body lines are captured whole — CIDR bare bodies containing colons
  const bareBodySet = new Set(config.bareBodyHeaders.map(normalizeHeader));

  // the block currently being filled; pushed to the result once closed. A block survives if it
  // carries entries OR a labelValue — a colon-less/empty header with neither is noise, but an
  // enumerated header that states its value inline (`Administrative contact: Individual`, no
  // body) is a real section whose value must still route (headerValueSuffix / block-label).
  let block: WhoisBlock | undefined;
  const lines = text.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    // blank line: block boundary — EXCEPT when a format opts into blankLinesInBlocks, where
    // enumerated headers delimit blocks and a blank is spacing (kg/bnnic write
    // `Contact:\n\n  Name: …`, so treating blank as a boundary would orphan every field). The
    // DEFAULT stays blank = boundary: za.net writes contiguous positional blocks separated by
    // blanks, with a trailing prose footer that must not glue onto the last data block. A
    // block also closes when the next enumerated header opens, or at EOF.
    if (!line.trim()) {
      if (config.blankLinesInBlocks && headerSet.size) continue;
      if (block && (block.entries.length || block.labelValue)) result.blocks.push(block);
      block = undefined;
      continue;
    }

    // notices/disclaimers are captured as first-class output and never become data
    if (isNotice(line, config.noticePrefixes)) {
      result.notices.push(line.trim());
      continue;
    }

    // a declared colon-less header opens a labeled block (KazNIC family). Only lines with no
    // colon are eligible, so a normal `Key: value` never trips it; and only ENUMERATED
    // headers match, so prose lines fall through to leftovers rather than becoming sections.
    if (headerSet.size && !line.includes(':') && headerSet.has(normalizeHeader(line))) {
      if (block && (block.entries.length || block.labelValue)) result.blocks.push(block);
      block = { label: line.trim(), entries: [] };
      continue;
    }

    // a body line under a bare-body section is captured WHOLE as one discrete keyless
    // entry — for BOTH colon and non-colon lines, and independent of the format's
    // foldContinuations. This keeps a positional bare block's lines separate even when the
    // format folds continuations elsewhere (dns.pl folds its NS list yet needs the REGISTRAR
    // block's name/address/url/phone/email lines kept one-per-entry). A nested enumerated header
    // still opens its own block rather than being swallowed.
    if (bareBodySet.size && block?.label && bareBodySet.has(normalizeHeader(block.label))) {
      const headerKey = KV_LINE.exec(line)?.[1]?.trim();
      if (!(headerKey && headerSet.has(normalizeHeader(headerKey)))) {
        block.entries.push({ key: '', value: line.trim(), line: lineNumber });
        continue;
      }
    }

    const kvRegex = config.keyValueSplit === 'multispace' ? KV_LINE_MULTISPACE : KV_LINE;
    const match = kvRegex.exec(line);
    const key = match?.[1]?.trim();
    const value = match?.[2] ?? '';

    if (match && key && key.length <= config.maxKeyLength) {
      // an ENUMERATED colon-carrying header (`Administrative Contact:`, key in headerSet) opens
      // a labeled block — the same enumeration that gates colon-less headers, extended to
      // headers that keep their colon. This is what lets a redacted empty field (`Name:`, NOT
      // enumerated) stay a plain entry instead of hijacking the block the way blanket
      // `empty-value` mode does. An enumerated header MAY carry a value (`Registrant: <name>`);
      // it is banked on the block as labelValue for the mapping pass to route.
      const enumeratedHeader = headerSet.size && headerSet.has(normalizeHeader(key));
      // a labeled header closes the open block and opens a titled one
      if (enumeratedHeader || (!value && config.blockLabels === 'empty-value')) {
        if (block && (block.entries.length || block.labelValue)) result.blocks.push(block);
        block = { label: key, entries: [] };
        if (value) block.labelValue = value;
        continue;
      }
      block ??= { entries: [] };
      block.entries.push({ key, value, line: lineNumber });
      continue;
    }

    // no key/value: a continuation of the previous entry, a bare block value, or a
    // leftover. A continuation must directly follow an entry inside the same block — a
    // blank line already closed the block, so prose paragraphs can't silently glue onto a
    // field's value.
    const previous = block?.entries[block.entries.length - 1];
    if (config.foldContinuations && previous) {
      previous.value = previous.value ? `${previous.value}\n${line.trim()}` : line.trim();
      continue;
    }
    // in empty-value (labeled-block) mode, a bare line under an open section IS that
    // section's data — a hostname in a `Name servers:` block, `NOT DISCLOSED!` under
    // `Registrant:`. Captured as a keyless entry so pass 2 maps it via the block label
    // (mapping.ts scoped resolution). Non-labeled formats never reach here with an open
    // block for a keyless line, so their leftover behaviour is unchanged.
    if ((config.blockLabels === 'empty-value' || (headerSet.size && block?.label)) && block) {
      block.entries.push({ key: '', value: line.trim(), line: lineNumber });
      continue;
    }
    result.leftovers.push({ text: line.trim(), line: lineNumber });
  }
  // EOF flush — same guard as the in-loop boundaries: keep a value-header block that carries a
  // labelValue but no body (`Administrative contact: Individual` as the last line, no trailing
  // blank), so its headerValue still routes in pass 2.
  if (block && (block.entries.length || block.labelValue)) result.blocks.push(block);

  return result;
}

// every entry across every block, in document order — the mapping pass's input for flat
// formats (icann), where the role lives in the key prefix rather than in block structure
export function allEntries(blocks: WhoisBlocks): WhoisEntry[] {
  return blocks.blocks.flatMap(block => block.entries);
}
