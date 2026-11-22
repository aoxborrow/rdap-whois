// .bg (Register.BG) — KV-ish but the two lossy fields need old-parser value semantics:
// `DOMAIN NAME: abv.bg (abv.bg)` (the `(\S+)` capture stops before the parenthesized
// repeat) and nameservers are bare lines under `NAME SERVER INFORMATION:`. Both ride the
// regexFields bridge. Its not-found wording is in server-meta.ts.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  regexFields: {
    domainName: 'DOMAIN NAME:\\s+(\\S+)',
    nameservers:
      '(?<=NAME SERVER INFORMATION:\\s*\\n)((?:[^\\s<][^\\n]*(?:\\n|$))+)(?=\\s*$|\\s*<)',
  },
};
