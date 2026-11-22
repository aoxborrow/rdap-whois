// .tr (whois.nic.tr + whois.trabis.gov.tr, same format) — `**`-prefixed SECTION HEADERS
// (`** Registrant`, `** Registrar`, `** Domain Servers`); dropping `*` from noticePrefixes
// keeps them as data. Registrant is a positional line (name; the rest is `Hidden upon user
// request`), registrar is a keyed block (`NIC Handle` → id, `Organization Name` → name), NS
// is a bare list.
import type { FormatConfig } from '../formats';

export const nicTr: FormatConfig = {
  format: 'block-scoped',
  noticePrefixes: ['%', '#', '>>>'],
  sectionHeaders: ['** Registrant', '** Registrar', '** Domain Servers'],
  positionalTemplates: { '** registrant': { scope: 'registrant', lines: ['name'] } },
  blockScopes: { '** registrar': 'registrar' },
  blockFields: { '** domain servers': 'nameservers' },
  scopeAliases: { id: ['NIC Handle'], name: ['Organization Name', 'Name'] },
  aliases: {
    domainName: ['** Domain Name'],
    eppStatus: ['Domain Status'],
    updatedDate: ['Last Update Time'],
    creationDate: ['Created on'],
    expirationDate: ['Expires on'],
  },
};
