// .sa (SaudiNIC) — colon-header contact sections (`Registrant:`, `Administrative Contact:`,
// `Technical Contact:`, `Name Servers:`) with bare positional bodies: first line is the org
// (registrant) or person (admin/tech), `Address:` keys fold to _address, and the NS block is a
// bare host list. Redacted values come through as `*****`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Administrative Contact', 'Technical Contact', 'Name Servers'],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
  },
  blockFields: { 'name servers': 'nameservers' },
  positionalTemplates: {
    // the single registrant line is org for some domains, a person/company name for others,
    // and nothing in the line says which — emit both.
    'registrant': { scope: 'registrant', lines: ['name+org'] },
    'administrative contact': { scope: 'admin', lines: ['name'] },
    'technical contact': { scope: 'tech', lines: ['name'] },
  },
  // the ICANN-style keys SaudiNIC answers with since 2026, beside the old sections
  aliases: {
    domainName: ['Domain Name'],
    dnssec: ['DNSSEC'],
    nameservers: ['Name Server'],
    registrantName: ['Registrant Name'],
  },
};
