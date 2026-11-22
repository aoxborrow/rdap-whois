// The `fred` format: the FRED registry software
// (CZ.NIC) used by .cz, .cr, .mk, .ls, .mw, .ve, .tz. Like rpsl it is object-based with
// handle references, but the domain object names contacts with `registrant:`/`admin-c:`
// and each contact is a `contact:` object. Nameservers live in a separate `nsset:` object
// (which can itself carry the `tech-c:` reference).
//
// FRED writes DAY-FIRST dotted dates (`registered: 21.07.2000 15:21:00`) — hence
// `options.dayFirst`, read by base.ts's dateFormatter. Domain-level aliases only, same
// reasoning as rpsl: contact fields come exclusively from role-scoped `contact:` objects.
import { SCOPE_ALIASES } from '../aliases';
import type { AliasTable, WhoisFormat } from '../types';

const FRED_DOMAIN_ALIASES: AliasTable = {
  domainName: ['domain'],
  eppStatus: ['status'],
  creationDate: ['registered'],
  updatedDate: ['changed', 'modified'],
  expirationDate: ['expire', 'expires'],
  nameservers: ['nserver'],
  dnssec: ['dnssec'],
  registrarName: ['registrar'],
};

export const fredFormat: WhoisFormat = {
  name: 'fred',
  tokenizer: { blockLabels: 'none', foldContinuations: false },
  roleResolution: 'handle-ref',
  aliases: FRED_DOMAIN_ALIASES,
  scopeAliases: SCOPE_ALIASES,
  // `registrant:` in the domain object references the registrant contact (and doubles as
  // the registrant id); `admin-c:`/`tech-c:` reference the others
  handleRefs: { 'registrant': 'registrant', 'admin-c': 'admin', 'tech-c': 'tech' },
  handleKey: 'contact',
  options: { dayFirst: true },
  meta: {
    notfound: ['^\\s*%*\\s*No entries found'],
    // FRED's rate-limit page (`% Your connection limit exceeded`) is a THROTTLE, not a
    // notfound — filed as notfound it would render the domain "available" and skip the
    // retry path.
    throttled: ['^\\s*%*\\s*Your connection limit exceeded'],
  },
};
