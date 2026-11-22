// The `rpsl` format: the RPSL / RIPE-database
// object style used by AFNIC (.fr/.re/.pm/.tf/.wf/.yt), ISNIC (.is), .ua, and .at. The
// response is a sequence of blank-line-separated OBJECTS; the domain object references its
// contacts by handle (`holder-c:`, `admin-c:`, `tech-c:`) and each contact is a separate
// `nic-hdl:` object elsewhere in the response. Role is resolved by matching the reference
// to the object's own handle (mapping.ts `handle-ref`).
//
// The alias table here is DELIBERATELY DOMAIN-LEVEL ONLY. A bare `address:`/`phone:`/
// `e-mail:` appears in the registrar object AND every contact object; mapping those
// globally would file the registrar's address as the registrant's. Every contact field
// instead comes from a role-scoped `nic-hdl:` object via SCOPE_ALIASES.
import { SCOPE_ALIASES } from '../aliases';
import type { AliasTable, WhoisFormat } from '../types';

const RPSL_DOMAIN_ALIASES: AliasTable = {
  domainName: ['domain'],
  // AFNIC sends both a human `status:` and machine `eppstatus:`; keep the readable one first
  eppStatus: ['status', 'eppstatus'],
  creationDate: ['created', 'registered'],
  updatedDate: ['last-update', 'changed', 'modified'],
  expirationDate: ['Expiry Date', 'expire', 'expires'],
  nameservers: ['nserver'],
  dnssec: ['dnssec'],
  // the domain object's `registrar:` is the sponsoring registrar name
  registrarName: ['registrar'],
  registrarWhoisServer: ['whois', 'refer'],
};

export const rpslFormat: WhoisFormat = {
  name: 'rpsl',
  // objects are blank-line separated; keys repeat (`nserver:` × N, `address:` × N) and
  // continuations don't occur — every datum is on its own `key: value` line
  tokenizer: { blockLabels: 'none', foldContinuations: false },
  roleResolution: 'handle-ref',
  aliases: RPSL_DOMAIN_ALIASES,
  scopeAliases: SCOPE_ALIASES,
  handleRefs: { 'holder-c': 'registrant', 'admin-c': 'admin', 'tech-c': 'tech' },
  handleKey: 'nic-hdl',
  // AFNIC writes a standalone `registrar:`-led object (address/country/phone/fax-no/e-mail/
  // website) — scope it to the registrar role so those subfields land instead of dropping.
  registrarBlockKey: 'registrar',
  meta: {
    notfound: ['^\\s*%*\\s*No entries found', '^\\s*%*\\s*NOT FOUND', '^\\s*%*\\s*Not registered'],
  },
};
