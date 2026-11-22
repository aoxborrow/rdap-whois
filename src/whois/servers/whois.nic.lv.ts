// .lv (nic.lv) — `[Domain]`/`[Holder]`/`[Tech]`/`[Registrar]` bracket headers + keyed
// Name/Country/Address; block-scoped (Name in SCOPE_ALIASES → registrant/registrar name).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['[Domain]', '[Holder]', '[Tech]', '[Registrar]'],
  blockScopes: { '[holder]': 'registrant', '[tech]': 'tech', '[registrar]': 'registrar' },
  aliases: {
    domainName: ['Domain'],
    eppStatus: ['Status'],
    updatedDate: ['Updated'],
    nameservers: ['Nserver'],
  },
};
