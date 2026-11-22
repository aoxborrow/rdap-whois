// P2 structural fingerprinting (docs/archive/whois-parser-refactor.md §6, "format fingerprinting").
//
// A "format" is keyed by the registry OPERATOR or SOFTWARE, not the TLD (§3). P1 asserted
// that hypothesis with two hand-built formats; P2 tests it with data by extracting a
// *structural* fingerprint from each server's raw responses and grouping servers that look
// the same. If the operator/software hypothesis holds, a handful of signatures should cover
// most servers, with a long bespoke tail riding `generic-kv` (weppos's empirical split:
// ~13 shared families ≈ 90 hosts, ~120 bespoke — §6).
//
// This module is the pure, testable half: raw response -> Fingerprint. The clustering,
// assignment cascade and reporting live in fingerprint.ts. Nothing here is runtime code —
// it only reads the fixture corpus offline, and it does NOT touch the old engine.
import { tokenize, allEntries } from '../../../src/whois/blocks';
import { normalizeKey } from '../../../src/whois/mapping';
import { normalizeRawText } from '../../../src/whois/raw-text';
import { stripRawMetadata } from '../lib/raw';

// The RA-spec keys that mark an ICANN-shaped flat-KV response. Deliberately a private copy
// of ab-parsers.ts's ICANN_MARKERS: P2 is the thing that will eventually REPLACE that
// harness's stand-in classifier, so coupling them now would be coupling to the thing we are
// trying to supersede. Kept in sync by hand; both are the standard gTLD field labels.
const ICANN_MARKERS = [
  'registry domain id',
  'registrar iana id',
  'registrar whois server',
  'registrar abuse contact email',
  'domain status',
  'name server',
  'creation date',
  'updated date',
];

// categorical feature axes — kept DISCRETE so a fingerprint signature is a short string that
// either matches another server's or doesn't (that is what makes clustering deterministic
// and the coverage table legible, vs. a float distance metric nobody can eyeball).
export type NoticeStyle = 'pct' | 'hash' | 'none';
export type SeparatorStyle = 'dotted' | 'colon';
export type LabelStyle = 'headers' | 'flat';
export type BlocksBucket = '1' | '2-3' | '4+';

// operator/software markers — HIGH-PRECISION (anchored, structural), never loose substring
// (the same discipline as the anchored meta patterns, §4). A false marker mis-assigns a
// whole server, so each is a shape only that operator emits.
export type OperatorMarker = 'cocca' | 'rpsl' | 'fred';

export type Fingerprint = {
  notice: NoticeStyle;
  separator: SeparatorStyle;
  labels: LabelStyle;
  continuations: boolean;
  // count of RA-spec keys present (0..ICANN_MARKERS.length) — bucketed in the signature
  icannKeys: number;
  blocks: BlocksBucket;
  markers: OperatorMarker[];
};

// the `>>> Last update of WHOIS database: ... <<<` footer is near-universal across ICANN
// responses (1264/1391 fixtures) and says nothing about operator — exclude it so it does not
// drown out the actual leading notice block that DOES distinguish RPSL/RIPE-db style output.
const FOOTER_NOTICE = /^>>>.*<<<\s*$/;

// a key with >=3 dots run before the colon: the dotted-padding style (`Name Server......:`),
// used by ati.tn-style labeled-block registries and `.ax`.
const DOTTED_KEY = /\.{3,}/;

function classifyNotice(notices: string[]): NoticeStyle {
  const leading = notices.filter(n => !FOOTER_NOTICE.test(n));
  const pct = leading.filter(n => n.trimStart().startsWith('%')).length;
  const hash = leading.filter(n => n.trimStart().startsWith('#')).length;
  // require a real block of them (>=2), so a single stray comment line does not flip the axis
  if (pct >= 2 && pct >= hash) return 'pct';
  if (hash >= 2) return 'hash';
  return 'none';
}

// section headers = a `Key:` line with an empty value whose data is INDENTED beneath it,
// the ati.tn / .il / nominet "Owner Contact:" shape (§3 labeled-blocks). Indentation is the
// discriminator that separates a real header from an ICANN *redacted* field: standard flat
// ICANN output writes `Registrar Abuse Contact Email:` with an empty value and the next
// field flush-left at the SAME indent, which is a null field, not a section. A labeled-block
// registry indents the section body. Detecting on empty-value-opens-a-block alone (the
// tokenizer's `empty-value` mode) can't tell them apart — it flags every redacted gTLD field
// — so we look at raw indentation directly.
const EMPTY_VALUE_LINE = /^(\s*)([^:\s][^:]*):\s*$/;
const INDENTED_LINE = /^(\s+)\S/;
function hasSectionHeaders(raw: string): boolean {
  const lines = stripRawMetadata(normalizeRawText(raw)).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = EMPTY_VALUE_LINE.exec(lines[i]);
    if (!header) continue;
    const headerIndent = header[1].length;
    // look at the next non-blank line: a real section indents its body deeper than the header
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) break; // blank line closes the section before any body → null field
      const body = INDENTED_LINE.exec(lines[j]);
      if (body && body[1].length > headerIndent) return true;
      break; // first body line at same-or-less indent → flush-left field, not a header
    }
  }
  return false;
}

function detectMarkers(raw: string, keys: Set<string>): OperatorMarker[] {
  const markers: OperatorMarker[] = [];
  const text = stripRawMetadata(normalizeRawText(raw));
  // CoCCA identifies itself in the disclaimer/footer prose, not in a key — weppos keys its
  // BaseCocca family off the same literal.
  if (/\bCoCCA\b/i.test(text)) markers.push('cocca');
  // RPSL/RIPE-database objects: a handle key plus maintainer/source is a shape only RPSL
  // servers emit (national ccTLDs mirroring the RIPE db: .il, .sk, RIR whois).
  if (keys.has('nic-hdl') || (keys.has('mnt-by') && keys.has('source'))) markers.push('rpsl');
  // FRED (CZ.NIC's registry daemon, §3) emits its own object types nsset/keyset — no other
  // software uses those key names.
  if (keys.has('nsset') || keys.has('keyset')) markers.push('fred');
  return markers;
}

// Extract the structural fingerprint of a single raw whois response. Total, never throws —
// same contract as the tokenizer it is built on.
export function fingerprint(raw: string): Fingerprint {
  const blocks = tokenize(raw);
  const entries = allEntries(blocks);
  const keys = new Set(entries.map(e => normalizeKey(e.key)));

  const dotted = entries.filter(e => DOTTED_KEY.test(e.key)).length;
  const separator: SeparatorStyle =
    entries.length > 0 && dotted / entries.length >= 0.25 ? 'dotted' : 'colon';

  const continuations = entries.some(e => e.value.includes('\n')) || blocks.leftovers.length > 0;

  const icannKeys = ICANN_MARKERS.filter(m => keys.has(m)).length;

  const blockCount = blocks.blocks.length;
  const bucket: BlocksBucket = blockCount <= 1 ? '1' : blockCount <= 3 ? '2-3' : '4+';

  return {
    notice: classifyNotice(blocks.notices),
    separator,
    labels: hasSectionHeaders(raw) ? 'headers' : 'flat',
    continuations,
    icannKeys,
    blocks: bucket,
    markers: detectMarkers(raw, keys),
  };
}

// the discrete signature string used to group servers into structural clusters. Bucketing
// icannKeys (none / few / many) rather than using the raw count keeps clusters from
// splintering on a single optional field being present or absent.
export function signature(fp: Fingerprint): string {
  const icann = fp.icannKeys === 0 ? 'icann0' : fp.icannKeys >= 5 ? 'icannHi' : 'icannLo';
  const cont = fp.continuations ? 'cont' : 'flat';
  const markers = fp.markers.length ? fp.markers.slice().sort().join('+') : 'none';
  return [
    `n:${fp.notice}`,
    `s:${fp.separator}`,
    `l:${fp.labels}`,
    cont,
    icann,
    `b:${fp.blocks}`,
    `m:${markers}`,
  ].join('|');
}

// The format-assignment cascade (docs/archive/whois-parser-refactor.md §3/§6). Priority order: a
// high-precision operator marker wins first (those shapes are unambiguous), then section
// headers => labeled-blocks, then RA-spec keys => icann, else the generic-kv fallback.
// Returns a WORKING format name; the taxonomy is validated (or revised) by the residual
// clustering in fingerprint.ts, not asserted as final here.
export type WorkingFormat = 'cocca' | 'rpsl' | 'fred' | 'labeled-blocks' | 'icann' | 'generic-kv';

export function assignFormat(fp: Fingerprint): WorkingFormat {
  if (fp.markers.includes('rpsl')) return 'rpsl';
  if (fp.markers.includes('fred')) return 'fred';
  if (fp.markers.includes('cocca')) return 'cocca';
  // a headers-style layout that ISN'T ICANN-flat is the ati.tn labeled-block family (the
  // counted-newline-hack files, §1). ICANN responses never lead with empty-value headers.
  if (fp.labels === 'headers' && fp.icannKeys < 3) return 'labeled-blocks';
  if (fp.icannKeys >= 3) return 'icann';
  return 'generic-kv';
}
