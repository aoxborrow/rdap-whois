// .sm (nic.sm) — POSITIONAL bare lines (name, address, city-line, country) under empty-value
// `Owner:`/`Technical Contact:` headers, THEN keyed `Phone:`/`Fax:`/`Email:` (resolved to the
// block's scope). NS list under `DNS Servers:`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Owner', 'Technical Contact', 'DNS Servers'],
  positionalTemplates: {
    'owner': { scope: 'registrant', lines: ['name'] },
    'technical contact': { scope: 'tech', lines: ['name', 'org'] },
  },
  blockFields: { 'dns servers': 'nameservers' },
  aliases: {
    domainName: ['Domain Name'],
    creationDate: ['Registration date'],
    eppStatus: ['Status'],
  },
  options: { dayFirst: true },
};
