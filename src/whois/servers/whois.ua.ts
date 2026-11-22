// .ua (UANIC/UAEPP) — RPSL-ish objects whose section markers are COMMENT lines (`% Registrant:`,
// `% Administrative Contacts:`, `% Registrar:`), so preprocess rewrites just those three into
// real enumerated headers before tokenizing (every other `%` line stays a notice). The contact
// objects carry their own `created:`/`status:`/`source:` — scopeStrict keeps those out of the
// domain-level fields (the domain object is the unlabeled first block). Keyed `-loc` fields map
// via scope aliases; the repeated `address-loc:` trio is street/state/city BY POSITION, which
// rides the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  scopeStrict: true,
  preprocess: raw => raw.replace(/^% (Registrant|Administrative Contacts|Registrar):\s*$/gm, '$1:'),
  sectionHeaders: ['Registrant', 'Administrative Contacts', 'Registrar'],
  blockScopes: {
    'registrant': 'registrant',
    'administrative contacts': 'admin',
    'registrar': 'registrar',
  },
  scopeAliases: {
    // `person: n/a` + `person-loc: <real name>` — replace the base name aliases so the
    // placeholder line can't win; the registrar object's name is its `organization:` line.
    name: ['person-loc', 'organization'],
    org: ['organization-loc'],
    postalCode: ['postal-code-loc'],
    country: ['country-loc', 'country'],
    // `address: n/a` would win the base alias; the real street rides regexFields below
    address: [],
    abuseEmail: ['abuse-email'],
    abusePhone: ['abuse-phone'],
  },
  aliases: {
    domainName: ['domain'],
    nameservers: ['nserver'],
    creationDate: ['created'],
    updatedDate: ['modified'],
    expirationDate: ['expires'],
    eppStatus: ['status'],
  },
  regexFields: {
    registrantAddress: '(?<=Registrant:)[\\s\\W\\w]*?address-loc:\\s+(.*)\\n',
    registrantState:
      '(?<=Registrant:)[\\s\\W\\w]*?(?:address\\-loc:\\s+.*\\n){1}address-loc:\\s+(.*)\\n',
    registrantCity:
      '(?<=Registrant:)[\\s\\W\\w]*?(?:address\\-loc:\\s+.*\\n){2}address-loc:\\s+(.*)\\n',
    adminAddress: '(?<=Administrative Contacts:)[\\s\\W\\w]*?address-loc:\\s+(.*)\\n',
    adminState:
      '(?<=Administrative Contacts:)[\\s\\W\\w]*?(?:address\\-loc:\\s+.*\\n){1}address-loc:\\s+(.*)\\n',
    adminCity:
      '(?<=Administrative Contacts:)[\\s\\W\\w]*?(?:address\\-loc:\\s+.*\\n){2}address-loc:\\s+(.*)\\n',
  },
};
