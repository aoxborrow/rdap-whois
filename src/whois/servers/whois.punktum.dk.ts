// .dk (Punktum) — `Hostname` NS list; the sole `Name:` line sits under the Registrant section.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    nameservers: ['Hostname'],
    registrantPostalCode: ['Postalcode'],
    registrantName: ['Name'],
  },
};
