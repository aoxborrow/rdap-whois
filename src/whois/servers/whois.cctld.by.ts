// .by (CcTLD BY) — RIPE-ish flat keys the generic table lacks spellings for
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    updatedDate: ['Update Date'],
    registrantName: ['Person'],
    registrantOrg: ['Org'],
    registrantCountry: ['Country'],
    registrantAddress: ['Address'],
    registrantPhone: ['Phone'],
    registrantId: ['Registration or other identification number'],
    registrantEmail: ['Email'],
  },
};
