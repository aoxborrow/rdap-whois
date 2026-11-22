// .tn (Tunisian Internet Agency) — colon-less contact section headers (`Owner Contact`,
// `Administrativ contact` [sic], `Technical contact`) with dot-padded keys
// (`Name................:`, normalizeKey strips the dots). Block-scoped config; the
// Name/Address/Phone/Fax/Email subfields are all in SCOPE_ALIASES already. The `DNS servers`
// section lists each nameserver under a `Name:` key inside a mixed block (interleaved
// `IP address` / `IP n° 1:` rows) — a per-block keyed list the block engine can't express
// yet, so nameservers ride the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Owner Contact', 'Administrativ contact', 'Technical contact'],
  blockScopes: {
    'owner contact': 'registrant',
    'administrativ contact': 'admin',
    'technical contact': 'tech',
  },
  scopeAliases: { state: ['stateProvince'], postalCode: ['Zip code'] },
  aliases: {
    domainName: ['Domain name'],
    eppStatus: ['Domain status'],
    registrarName: ['Registrar'],
    creationDate: ['Creation date'],
    dnssec: ['dnssec'],
  },
  regexFields: {
    nameservers: 'Name\\.+: ([\\w\\.\\-]+)\\.',
  },
  options: { dayFirst: true },
};
