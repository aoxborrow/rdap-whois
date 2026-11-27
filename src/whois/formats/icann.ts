// The `icann` format: standard `Key: Value` flat KV
// per the ICANN Registrar Accreditation spec. Expected coverage: most gTLD registries +
// registrars (Verisign, Identity Digital, GoDaddy Registry, CentralNic/Team Internet, …).
//
// This format is FLAT — there are no role blocks. The contact role lives in the key
// prefix, so the alias table maps fully-qualified keys (`Registrant Email` →
// registrantEmail) directly. Block structure is still tokenized (blank lines split
// it), but mapping ignores it and reads every entry in document order.
//
// Alias lists are ordered = the collision rule (../types.ts). They were mined
// from the found corpus by key frequency, not guessed; the long tail lands in
// generic-kv.ts.
import { MINED_ALIASES, mergeAliases } from '../aliases';
import type { AliasTable, WhoisFormat } from '../types';
import { scopedField } from '../fields';

// contact fields repeat identically across the four roles — generate them rather than
// hand-copying 4 × 13 lines, which is exactly where a typo'd role would hide
const CONTACT_ROLES = {
  registrant: 'Registrant',
  admin: 'Admin',
  tech: 'Tech',
  billing: 'Billing',
} as const;

function contactAliases(): AliasTable {
  const table: AliasTable = {};
  for (const [role, prefix] of Object.entries(CONTACT_ROLES)) {
    // `Registry <Role> ID` is the RA-spec key; the bare `<Role> ID` is the older form
    table[scopedField(role, 'id')] = [`Registry ${prefix} ID`, `${prefix} ID`];
    // the bare role key (`Registrant: Google LLC`, whois.nic.ge) is the name in practice,
    // but it ranks LAST so an explicit `Registrant Name:` always wins the collision
    table[scopedField(role, 'name')] = [`${prefix} Name`, `${prefix} Contact Name`, prefix];
    table[scopedField(role, 'org')] = [`${prefix} Organization`, `${prefix} Organisation`];
    table[scopedField(role, 'address')] = [
      `${prefix} Street`,
      `${prefix} Street Address`,
      `${prefix} Address`,
    ];
    table[scopedField(role, 'city')] = [`${prefix} City`];
    table[scopedField(role, 'state')] = [`${prefix} State/Province`, `${prefix} State`];
    table[scopedField(role, 'postalCode')] = [`${prefix} Postal Code`, `${prefix} Zip code`];
    table[scopedField(role, 'country')] = [`${prefix} Country`];
    table[scopedField(role, 'phone')] = [`${prefix} Phone`];
    table[scopedField(role, 'phoneExt')] = [`${prefix} Phone Ext`];
    table[scopedField(role, 'fax')] = [`${prefix} Fax`, `${prefix} Facsimile Telephone Number`];
    table[scopedField(role, 'faxExt')] = [`${prefix} Fax Ext`];
    table[scopedField(role, 'email')] = [`${prefix} Email`, `${prefix} Contact Email`];
  }
  return table;
}

export const ICANN_ALIASES: AliasTable = {
  // domain
  domainId: ['Registry Domain ID', 'Domain ID'],
  // keys are matched case-insensitively (mapping.ts normalizeKey), so listing case
  // variants of the same spelling would be redundant
  domainName: ['Domain Name', 'Domain'],
  creationDate: ['Creation Date', 'Created On', 'Created', 'Created Date', 'Registration Date'],
  // collision rule in action: the REGISTRY's expiry is authoritative over the
  // registrar's copy of it (CoCCA sends both, and they can disagree)
  expirationDate: [
    'Registry Expiry Date',
    'Registrar Registration Expiration Date',
    'Registrar Expiration Date',
    'Expiration Date',
    'Expiry Date',
    'Expires On',
  ],
  // the registrar's expiry, which a registry may pass on beside its own (CoCCA, ZACR). A
  // registrar's own server gives only this one, and it is the expirationDate there too
  registrarExpirationDate: ['Registrar Registration Expiration Date', 'Registrar Expiration Date'],
  updatedDate: ['Updated Date', 'Last Updated On', 'Last Update', 'Last Modified'],
  eppStatus: ['Domain Status', 'Status'],
  nameservers: ['Name Server', 'Name Servers', 'Nameserver'],
  dnssec: ['DNSSEC'],

  // registrar
  registrarId: ['Registrar IANA ID', 'Sponsoring Registrar IANA ID'],
  registrarName: ['Registrar', 'Registrar Name', 'Sponsoring Registrar'],
  registrarReseller: ['Reseller'],
  registrarUrl: ['Registrar URL', 'Referral URL', 'Sponsoring Registrar URL'],
  registrarWhoisServer: ['Registrar WHOIS Server', 'Registry WHOIS Server', 'WHOIS Server'],
  registrarAddress: ['Registrar Street', 'Registrar Street Address', 'Registrar Address'],
  registrarCity: ['Registrar City'],
  registrarState: ['Registrar State/Province'],
  registrarPostalCode: ['Registrar Postal Code'],
  registrarCountry: ['Registrar Country'],
  registrarPhone: ['Registrar Phone'],
  registrarPhoneExt: ['Registrar Phone Ext'],
  registrarFax: ['Registrar Fax'],
  registrarFaxExt: ['Registrar Fax Ext'],
  registrarEmail: ['Registrar Email'],
  // the RA-spec key is `... Contact ...`; the shorter spelling is common off-spec
  // (whois.domains.co.za) and the old base regex accepted both
  registrarAbuseEmail: ['Registrar Abuse Contact Email', 'Registrar Abuse Email'],
  registrarAbusePhone: ['Registrar Abuse Contact Phone', 'Registrar Abuse Phone'],

  ...contactAliases(),
};

export const icannFormat: WhoisFormat = {
  name: 'icann',
  // ICANN output writes redacted fields as `Key:` with an empty value, so an empty value
  // must NOT be read as a section label here (blocks.ts `blockLabels`)
  tokenizer: { blockLabels: 'none', foldContinuations: true },
  // corpus-mined aliases apply to icann-CLASSIFIED responses too (the AU-family evidence
  // behind `Registrant Contact ID` was icann-shaped — PR #370 review finding); appended
  // AFTER the spec spellings so the collision rule keeps the canonical key's priority.
  // ICANN_ALIASES itself stays the pure spec table (generic-kv builds on it).
  aliases: mergeAliases(ICANN_ALIASES, MINED_ALIASES),
  // ANCHORED — the whole point. A substring match finds "not found" anywhere in a response,
  // including inside legal boilerplate, and calls a registered name available.
  meta: {
    notfound: [
      '^\\s*No match for ',
      '^\\s*NOT FOUND\\s*$',
      '^\\s*Domain not found\\.?\\s*$',
      '^\\s*No Data Found\\s*$',
      '^\\s*No object found\\.?\\s*$',
      '^\\s*The queried object does not exist',
      // — spellings mined from not-found responses the patterns above missed. Inline
      //   (?i:…) groups cover the all-caps / title / sentence variants one registry-to-the-
      //   next emits; leading %/#/> tolerated because some registries prefix the status line.
      //   Every pattern stays line-anchored (^) so it can't fire mid-disclaimer — the control
      //   set of registered names in the fixtures must stay at 0 false positives.
      '^\\s*\\[?(?i:(?:the )?domain\\b.{0,60}not found)', // DOMAIN NOT FOUND · Domain <x> not found · domain "<x>" not found.
      '^\\s*[%#]*\\s*(?i:not found)\\b', //                  %% NOT FOUND · Not found: <x> · not found...
      '^\\s*(?:Domain )?Status:\\s*(?i:no object found)', // Domain Status: No Object Found
      '^\\s*%*\\s*(?i:no match)\\b', //                      No match!! · % No match · NO MATCH: <x>
      '^\\s*(?i:no matching (?:record|domain))', //          No matching record. · No matching domain name found.
      '^\\s*%*.{0,12}(?i:no entries found)', //              %% No entries found... · %ERROR: no entries found
      '^\\s*%*.{0,12}(?i:no objects? found)', //             No Objects Found · %error 230 No Objects Found
      '^\\s*[%#]*\\s*(?i:object\\b.{0,40}(?:not found|does not exist))', // # Object not found · % Object "<x>" NOT FOUND.
      '^\\s*(?i:error:\\s*domain not found)', //             1API/HEXONET: ERROR: domain not found:
      '^\\s*"[^"]+" (?i:not found)\\.?\\s*$', //             "<x>" not found.
      '^\\s*(?i:\\S+\\.\\S+ no match)\\.?\\s*$', //          <domain> no match
      '^\\s*(?i:key not found)', //                          Key not found
      '^\\s*(?i:data not found)', //                         Data not found. This domain is available...
      '^\\s*(?i:(?:this |the |above )?domain(?: name)?\\b.{0,40}\\bnot(?: been)? registered)', // (This|The|Above) domain name has not been registered.
      '^\\s*(?i:status:\\s*(?:not registered|available))', //         Status: Not Registered · Status: AVAILABLE
      '^\\s*(?i:domain status:\\s*available)', //            Domain Status: Available
      '^\\s*>*\\s*(?i:(?:this )?domain\\b.{0,40}is available for registration)', // >>> Domain <x> is available for registration
      '^\\s*(?i:the requested domain was not found)', //     The requested domain was not found in the Registry
      '^\\s*(?i:invalid query or domain name not known)', // Freenom: Invalid query or domain name not known in Dot XX...
      '^\\s*(?i:the domain you requested is not known)', //  dominio.gq: ...not known in Freenoms database.
      '^\\s*(?i:nincs (?:találat|talalat))', //              Hungarian: Nincs találat / No match
      '^\\s*\\*+\\s*(?i:nothing found)', //                  *** Nothing found for this query.
      '^\\s*(?i:sorry, but domain: ".*", not found)', //     Sorry, but domain: "<x>", not found in database
      '^\\s*(?i:no match in database)', //                   No match in database
      '^\\s*(?i:.{0,40}does not exist in database)', //      Domain Name [<x>] does not exist in database
      '^\\s*(?i:domain does not exist)', //                   eurodns: Domain does not exist.
      '^\\s*NO DOMAIN\\s*$', //                             name.com
      '^\\s*DomainQuery \\S+ NOT FOUND', //                  cronon: DomainQuery <x> NOT FOUND
    ],
    throttled: [
      '^.*(?i:rate limit exceeded)', //                     mid-line after a retirement notice (brandsight/godaddy)
      '^\\s*Your (?:connection|query) limit exceeded',
      '^\\s*[#%]*\\s*(?i:too many (?:requests|connections))', // `# Too many connections.` (dk-hostmaster)
      '^\\s*Server is busy',
    ],
    reserved: ['^\\s*Reserved by (?:the )?Registry', '^\\s*This name is reserved'],
    servfail: [
      // Identity Digital's answer when a server is asked for a TLD it doesn't serve —
      // seen live. Not notfound: the DOMAIN
      // may well exist, we asked the wrong server.
      '^\\s*TLD is not supported\\.?\\s*$',
      '^\\s*This TLD has no whois server',
      '^\\s*Whois Server (?:is )?(?:temporarily )?[Uu]navailable',
      '^\\s*[%#]*\\s*(?:Error:\\s*)?(?i:service) (?:temporarily )?unavailable', // % Error: service unavailable (nic.sm)
      // Tucows Registry's answer for a TLD it no longer serves over port 43
      '^\\s*>*\\s*Tld not supported by this registry interface',
      '^\\s*WHOIS unavailable - please retry', //            easydns
      '^\\s*Request invalid\\s*$', //                        apiname
      "^\\s*We're sorry, there has been a problem", //       enom
    ],
  },
};
