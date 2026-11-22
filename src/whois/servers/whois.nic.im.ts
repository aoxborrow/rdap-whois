// .im (nic.im) — colon-less section headers (`Domain Owners / Registrant`, `Administrative
// Contact`, `Billing Contact`) with a keyed `Name:` sub-field (everything Redacted under
// GDPR). Plain block-scoped; `Name` is in SCOPE_ALIASES.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: [
    'Domain Owners / Registrant',
    'Administrative Contact',
    'Technical Contact',
    'Billing Contact',
  ],
  blockScopes: {
    'domain owners / registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
    'billing contact': 'billing',
  },
  // block-scoped base carries no domain-level aliases (unlike generic-kv), so declare them
  aliases: {
    domainName: ['Domain Name'],
    expirationDate: ['Expiry Date'],
    nameservers: ['Name Server'],
  },
  options: { dayFirst: true },
};
