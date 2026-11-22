// iana.org — DNSSEC DS records under repeated `ds-rdata:` keys.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { dnssec: ['ds-rdata'] },
};
