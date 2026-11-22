// .au (auDA registry host) — icann-shaped with `Registrant Contact ID`/`Registrant`/`Tech
// Contact ID` spellings.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'icann',
  aliases: {
    registrantId: ['Registrant Contact ID'],
    registrantOrg: ['Registrant'],
    techId: ['Tech Contact ID'],
  },
};
