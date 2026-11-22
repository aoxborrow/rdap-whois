// .sk (SK-NIC) — value-carrying block headers whose value is a HANDLE: `Domain registrant:
// <id>` and `Registrar: <id>` open scoped blocks and state the id (headerValueSuffix 'id');
// the real name comes from the block's `Name:` field. `Country Code` → country.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Domain registrant', 'Registrar'],
  blockScopes: { 'domain registrant': 'registrant', 'registrar': 'registrar' },
  headerValueSuffix: 'id',
  scopeAliases: { country: ['Country Code'] },
  aliases: {
    domainName: ['Domain'],
    eppStatus: ['Domain Status'],
    creationDate: ['Created'],
    updatedDate: ['Updated'],
    expirationDate: ['Valid Until'],
    nameservers: ['Nameserver'],
    dnssec: ['DNSSEC'],
  },
};
