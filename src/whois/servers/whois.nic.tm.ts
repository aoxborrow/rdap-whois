// .tm — numbered `NS <n>` nameservers + `Owner <field>` registrant. A nameserver's glue
// addresses follow it on lines of their own (`       : 194.0.1.11`), which fold into its
// value; only the first line is the nameserver.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    expirationDate: ['Expiry'],
    nameservers: ['NS 1', 'NS 2', 'NS 3', 'NS 4', 'NS 5', 'NS 6', 'NS 7', 'NS 8', 'NS 9'],
    registrantName: ['Owner Name'],
    registrantOrg: ['Owner OrgName'],
  },
  valueExtract: { nameservers: ['\\n[\\s\\S]*$', ''] },
};
