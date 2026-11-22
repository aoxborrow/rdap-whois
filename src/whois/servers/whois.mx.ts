// .mx (Registry .MX) — empty-value contact headers with keyed `Name:`/`City:`/`State:`/
// `Country:` sub-fields and a `Name Servers:` block of keyed `DNS:` lines. Block-scoped.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: [
    'Registrant',
    'Administrative Contact',
    'Technical Contact',
    'Billing Contact',
    'Name Servers',
  ],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
    'billing contact': 'billing',
  },
  aliases: {
    domainName: ['Domain Name'],
    creationDate: ['Created On'],
    updatedDate: ['Last Updated On'],
    expirationDate: ['Expiration Date'],
    registrarName: ['Registrar'],
    registrarUrl: ['URL'],
    nameservers: ['DNS'],
  },
};
