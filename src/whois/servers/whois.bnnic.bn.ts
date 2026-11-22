// .bn (BNNIC) — same keyed-body labeled shape as .kg: `Registrant:`/`Administrative
// Contact:`/`Technical Contact:` headers, blank line, then `Name:`/`Email:` sub-fields.
// Domain fields (`Creation Date`, `Modified Date`, …) sit under a value-carrying
// `Registrar:   <name>` line, mapped domain-level. Dates are `13-Feb-2014 00:00:00`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  blankLinesInBlocks: true,
  sectionHeaders: ['Registrant', 'Administrative Contact', 'Technical Contact', 'Name Servers'],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
  },
  blockFields: { 'name servers': 'nameservers' },
  aliases: {
    domainName: ['Domain Name'],
    creationDate: ['Creation Date'],
    updatedDate: ['Modified Date'],
    expirationDate: ['Expiration Date'],
    eppStatus: ['Domain Status'],
    registrarName: ['Registrar'],
  },
};
