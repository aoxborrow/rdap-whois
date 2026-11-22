// .укр (dotukr.com) — icann-shaped with a UTF8 domain variant and `Registry Status` /
// `Registrar ID` / `Registrant Name (Organization)` spellings. Nameservers arrive as bare
// lines under a `Domain servers in listed order:` header (no key), which the flat icann
// mapping can't reach — they ride the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'icann',
  aliases: {
    domainName: ['Domain name (UTF8)'],
    eppStatus: ['Registry Status'],
    registrarId: ['Registrar ID'],
    registrantName: ['Registrant Name (Organization)'],
  },
  regexFields: {
    nameservers: 'Domain servers in listed order:\\n((.+\\n)+)\\n',
  },
};
