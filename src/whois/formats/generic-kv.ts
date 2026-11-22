// The `generic-kv` format: the fallback — blank-line
// blocks + KV + global aliases, for every server with no format of its own, which is most
// of them.
//
// Note weppos never built this (unknown hosts get a `Blank` parser that only raises),
// so there is no prior art to port — the alias table below is mined from our own corpus's
// key frequencies (the RPSL/FRED/national tail: `nserver`, `descr`, `nic-hdl`, `nsset`,
// dotted `.ax` padding, …).
//
// It inherits every ICANN alias, because plenty of no-parser servers ARE ICANN-shaped;
// the additions are the non-ICANN spellings. Ordering matters (the collision rule): the
// ICANN spelling is listed first so a hybrid response resolves the same way `icann` would.
import { ICANN_ALIASES } from './icann';
import { MINED_ALIASES, mergeAliases } from '../aliases';
import type { AliasTable, WhoisFormat } from '../types';

// non-ICANN spellings observed in the corpus, appended AFTER the ICANN aliases for each
// canonical field so the ICANN spelling keeps priority
// Keys are matched case-insensitively and with dot-padding stripped (mapping.ts
// normalizeKey), so each spelling is listed ONCE — `nserver` covers `Nserver`, and
// `Name Server Handle` covers the dotted `Name Server Handle.........` form.
const EXTRA_ALIASES: AliasTable = {
  domainName: ['domain', 'Canonical Name', 'Internationalized Domain Name'],
  domainId: ['ROID'],
  creationDate: ['created', 'registered', 'Registration Time', 'Registered on'],
  expirationDate: ['expire', 'expires', 'Expiration Time', 'paid-till', 'Valid Until'],
  updatedDate: ['changed', 'modified', 'obsoleted'],
  eppStatus: ['status', 'eppstatus', 'state', 'Registration status'],
  // `nserver` is the RIPE-database/RPSL spelling
  // no bare `DNS` here: .rs declares it per-server; on punktum.dk `DNS:` echoes the ZONE
  // (`DNS: google.dk`), which the loosened nameserver-host filter would now let through
  nameservers: ['nserver', 'nameserver', 'Name Server Handle'],
  dnssec: ['dnssec', 'DNSSEC status', 'signed'],

  registrarName: ['registrar', 'Registration Service Provider', 'Record maintained by'],
  registrarWhoisServer: ['whois', 'refer', 'ReferralServer', 'Web-based WHOIS'],
  registrarUrl: ['Reseller URL', 'url'],
  registrarEmail: ['Reseller Email'],

  registrantId: ['registrant', 'ID Contact'],
  registrantName: ['person', 'First name'],
  registrantOrg: ['organisation', 'org', 'organization'],
  registrantAddress: ['address', 'address-loc', 'descr'],
  registrantCity: ['City', 'Ciudad'],
  // NOTE: no bare `State` here — it collides with the `state` domain-status spelling above
  // (RPSL ccTLDs write `state: REGISTERED…` / `state: active` for the DOMAIN, not a US state),
  // so it over-reached into registrantState on .ru/.se/… . Real gTLD registrant states come
  // through the icann format's `Registrant State/Province`, which is unaffected.
  registrantPostalCode: ['pcode', 'Zip code'],
  registrantCountry: ['country', 'País'],
  registrantPhone: ['phone', 'Teléfono'],
  registrantFax: ['fax', 'fax-no'],
  registrantEmail: ['email', 'e-mail', 'Correo electrónico'],

  adminId: ['admin-c'],
  techId: ['tech-c'],
};

// icann spellings, then the non-ICANN tail (EXTRA), then the corpus-mined aliases last — so
// the collision rule keeps the canonical spelling's priority and a mined alias only
// wins a field nothing better claimed (see MINED_ALIASES in ../aliases.ts)
export const GENERIC_KV_ALIASES: AliasTable = mergeAliases(
  mergeAliases(ICANN_ALIASES, EXTRA_ALIASES),
  MINED_ALIASES
);

export const genericKvFormat: WhoisFormat = {
  name: 'generic-kv',
  tokenizer: { blockLabels: 'none', foldContinuations: true },
  aliases: GENERIC_KV_ALIASES,
  // the fallback inherits icann's anchored meta patterns (formats.ts metaPatterns) plus the
  // spellings the non-ICANN tail uses
  meta: {
    notfound: [
      '^\\s*(?:%\\s*)?No entries found',
      '^\\s*(?:%\\s*)?Not registered',
      '^\\s*(?:%\\s*)?nothing found',
      '^\\s*(?:%\\s*)?No information available about domain name',
      '^\\s*Status:\\s*(?:free|AVAILABLE|available)\\s*$',
    ],
    throttled: [
      '^\\s*(?:%\\s*)?(?:Excessive|Too many) queries',
      '^\\s*(?:%\\s*)?Query rate limit',
      '^\\s*(?:%\\s*)?You have exceeded',
    ],
    reserved: ['^\\s*(?:%\\s*)?Reserved', '^\\s*Status:\\s*(?:reserved|not_open)\\s*$'],
    servfail: ['^\\s*(?:%\\s*)?(?:Database|Service) (?:is )?(?:temporarily )?unavailable'],
  },
};
