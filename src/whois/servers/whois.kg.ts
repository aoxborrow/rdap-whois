// .kg (cctld.kg) — enumerated colon-carrying contact headers (`Administrative Contact:`,
// `Technical Contact:`, `Billing Contact:`) with keyed sub-fields (`PID:`, `Email:`,
// `phone:`, `fax:`) and a blank line after each header. Rides the block-scoped base now that
// enumerated headers open blocks whether or not they keep their colon, and blank lines no
// longer close them. `PID` → `<scope>_id`; NS list under `Name servers in the listed order:`.
// domainName/status arrive in a positional `Domain NIC.KG (ACTIVE)` line, which is not read.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  blankLinesInBlocks: true,
  sectionHeaders: [
    'Administrative Contact',
    'Technical Contact',
    'Billing Contact',
    'Name servers in the listed order',
  ],
  blockScopes: {
    'administrative contact': 'admin',
    'technical contact': 'tech',
    'billing contact': 'billing',
  },
  blockFields: { 'name servers in the listed order': 'nameservers' },
  scopeAliases: { id: ['PID'] },
  aliases: {
    creationDate: ['Record created'],
    updatedDate: ['Record last updated on'],
    expirationDate: ['Record expires on'],
  },
  // domainName/status ride the positional `Domain NIC.KG (ACTIVE)` line — bridge rules
  regexFields: {
    domainName: 'Domain\\s*([\\w]+\\.[\\w]{2,5})',
    eppStatus: 'Domain [\\w\\.]+ \\((\\w+)\\)',
  },
};
