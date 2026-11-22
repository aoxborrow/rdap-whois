// .rs (RNIDS) — value-carrying contact headers: `Registrant: <name>`/`Administrative
// contact: <name>`/`Technical contact: <name>` state the NAME on the header line, then
// `Address`/`Postal Code`/`ID Number` follow. headerValueSuffix 'name' routes the header
// value to `<scope>_name`. Serbian day-first dates `26.04.2008`. Nameservers arrive as
// `DNS: host - ip`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Administrative contact', 'Technical contact'],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contact': 'admin',
    'technical contact': 'tech',
  },
  headerValueSuffix: 'name',
  aliases: {
    domainName: ['Domain name'],
    eppStatus: ['Domain status'],
    creationDate: ['Registration date'],
    updatedDate: ['Modification date'],
    expirationDate: ['Expiration date'],
    registrarName: ['Registrar'],
    dnssec: ['DNSSEC signed'],
    nameservers: ['DNS'],
  },
  // `DNS: host - 1.2.3.4` → host. Anchor on the ` -` IP separator (a SPACE before the dash),
  // not any dash — else a hostname with an internal dash (`bg1.mns-dns.net`) is truncated to
  // `bg1.mns` and then dropped as an invalid FQDN.
  valueExtract: { nameservers: [' +-.*$', ''] },
  options: { dayFirst: true },
};
