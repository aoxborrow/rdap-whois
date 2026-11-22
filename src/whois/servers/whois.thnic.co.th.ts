// .th (thnic) — `Domain Holder <field>` + `Created/Updated/Exp date` (DD Mon YYYY).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrantOrg: ['Domain Holder Organization'],
    registrantCountry: ['Domain Holder Country'],
    creationDate: ['Created date'],
    updatedDate: ['Updated date'],
    expirationDate: ['Exp date'],
    techName: ['Tech Contact'],
  },
};
