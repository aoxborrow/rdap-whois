// .ua (ukraine.com.ua registrar) — generic-kv reads it, except one malformed line: the registry
// omits the newline after DNSSEC, printing `DNSSEC: unsignedURL of the ICANN WHOIS Data Problem
// Reporting System: http://…` on a single line, so generic-kv captures the whole glued string.
// A regexField pulls just the keyword: `DNSSEC: *(unsigned)`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  regexFields: { dnssec: 'DNSSEC:\\s*(signed|unsigned)' },
};
