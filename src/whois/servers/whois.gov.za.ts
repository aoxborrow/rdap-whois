// .gov.za (ZADNA) — numbered application-form keys (`3a. Admin Contact Name`, `4d. Email`);
// the number prefix is stable per field, so it's part of the alias.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    domainName: ['1a. Domain Name'],
    registrantOrg: ['2a. Department Name'],
    registrantPostalCode: ['2c. Postal Code'],
    adminName: ['3a. Admin Contact Name'],
    adminOrg: ['3c. Department'],
    adminEmail: ['3d. Email'],
    techName: ['4a. Tech Contact Name'],
    techOrg: ['4c. Department'],
    techEmail: ['4d. Email'],
    nameservers: ['5a. Primary NS', '5c. Secondary NS'],
  },
};
