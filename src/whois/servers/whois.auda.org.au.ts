// .au (auDA) — icann-shaped with `Registrant:` (org) and `<Role> Contact ID` spellings.
// `Registrant Contact ID` must be a CONFIG alias (config spellings outrank the base
// format's): auDA also writes `Registrant ID: ACN 082 931 600` (the company number), which
// the icann table's canonical `Registrant ID` alias would otherwise win with — the old
// parser filed the contact handle (`...-AU`), not the ACN.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'icann',
  aliases: {
    registrantOrg: ['Registrant'],
    registrantId: ['Registrant Contact ID'],
    techId: ['Tech Contact ID'],
  },
};
