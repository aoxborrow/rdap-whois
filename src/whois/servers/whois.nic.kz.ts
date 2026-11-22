// .kz (KazNIC) — the colon-less-header archetype: the dedicated `kaznic` format
// reads its sections via the tokenizer's sectionHeaders + block-label mapping. KazNIC gives
// no tech contact of its own; one bridge rule files the FIRST `Name...:` line (the org's) as
// techName too.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'kaznic',
  regexFields: { techName: '^Name\\.*: *(.*)' },
};
