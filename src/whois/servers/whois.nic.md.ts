// .md (nic.md) — irregular fixed-width columns (`Domain  name    999.md`) whose gap widths
// vary per row, so neither the colon nor the multispace split fits. Rides the regexFields
// bridge wholesale.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  regexFields: {
    domainName: 'Domain\\s+name\\s+([\\w\\.\\-]+)',
    creationDate: 'Registered on (.+)',
    expirationDate: 'Expires\\s+on\\s+(\\d{4}-\\d{2}-\\d{2})',
    nameservers: 'Nameserver\\s+([\\w\\.\\-]+)',
    eppStatus: 'Domain state\\s+(.+)',
    registrarName: 'Registrar +(.+)',
  },
};
