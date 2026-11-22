// .ee (EIS — whois.tld.ee + whois.eenet.ee, same format) — empty-value section headers
// (`Domain:`, `Registrant:`, `Registrar:`) + keyed sub-fields. `org id` is filed as the org
// value, and the redaction string `Not Disclosed - Visit …` is kept as the value of a
// redacted name/email, as the server wrote it, so SCOPE_ALIASES pass them through verbatim. Registrar
// name/url/phone come from its block via SCOPE_ALIASES (`name`/`url`/`phone`).
import type { FormatConfig } from '../formats';

export const eis: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: [
    'Domain',
    'Registrant',
    'Administrative contact',
    'Technical contact',
    'Registrar',
  ],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
    'registrar': 'registrar',
  },
  scopeAliases: { org: ['org id', 'Organization'] },
  aliases: {
    domainName: ['name'],
    eppStatus: ['status'],
    creationDate: ['registered'],
    updatedDate: ['changed'],
    expirationDate: ['expire'],
    nameservers: ['nserver'],
  },
  // dates carry a ` +03:00` TZ the old regex dropped (kept the local time as UTC)
  valueExtract: {
    creationDate: [' *[+-]\\d{2}:\\d{2}$', ''],
    updatedDate: [' *[+-]\\d{2}:\\d{2}$', ''],
  },
};
