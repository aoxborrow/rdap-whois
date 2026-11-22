// .sn (NIC Sénégal) — `[HOLDER]`/`[ADMIN_C]`/`[TECH_C]`/`[BILLING_C]` BRACKET headers
// (colon-less) + French subfield keys, `ID Contact` → `<scope>_id`. Also on the
// block-scoped base; `Dernière modification` appears both domain-level and inside each
// contact block — the domain-level one is first in document order, so it wins updatedDate
// (the collision rule) and the contact copies drop to drift.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['[HOLDER]', '[ADMIN_C]', '[TECH_C]', '[BILLING_C]'],
  blockScopes: {
    '[holder]': 'registrant',
    '[admin_c]': 'admin',
    '[tech_c]': 'tech',
    '[billing_c]': 'billing',
  },
  scopeAliases: {
    id: ['ID Contact'],
    name: ['Nom'],
    address: ['Adresse'],
    postalCode: ['Code postal'],
    city: ['Ville'],
    country: ['Pays'],
    phone: ['Téléphone'],
    fax: ['Fax'],
    email: ['Courriel'],
  },
  aliases: {
    domainId: ['Domain ID'],
    domainName: ['Nom de domaine'],
    creationDate: ['Date de création'],
    updatedDate: ['Dernière modification'],
    expirationDate: ["Date d'expiration"],
    registrarName: ['Registrar'],
    eppStatus: ['Statut'],
    nameservers: ['Serveur de noms'],
    dnssec: ['DNSSEC'],
  },
};
