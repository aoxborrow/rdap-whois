// .hk (HKIRC) — empty-value contact headers followed by a BLANK line then keyed fields
// (`Given name`/`Family name`/`Company name`); block-scoped + blankLinesInBlocks. registrantOrg
// sits under a >64-char parenthetical key, which the tokenizer drops as prose; a bridge rule
// reads it.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  blankLinesInBlocks: true,
  sectionHeaders: [
    'Registrant Contact Information',
    'Administrative Contact Information',
    'Technical Contact Information',
    'Name Servers Information',
  ],
  blockScopes: {
    'registrant contact information': 'registrant',
    'administrative contact information': 'admin',
    'technical contact information': 'tech',
  },
  blockFields: { 'name servers information': 'nameservers' },
  scopeAliases: { name: ['Family name'], org: ['Company name'] },
  aliases: {
    domainName: ['Domain Name'],
    eppStatus: ['Domain Status'],
    dnssec: ['DNSSEC'],
    registrarName: ['Registrar Name'],
    creationDate: ['Domain Name Commencement Date'],
    expirationDate: ['Expiry Date'],
    // `Registrar Contact Information: Email: ccops@markmonitor.com` — the value carries its
    // own `Email:` label (this header is NOT a section, it keeps a value).
    registrarEmail: ['Registrar Contact Information'],
  },
  // an internationalised name is printed on the same line as its ASCII twin:
  // `Domain Name:  BAIDU.HK Bundled Domain Name:  百度.香港`
  valueExtract: {
    registrarEmail: ['^Email:\\s*', ''],
    domainName: ['\\s+Bundled Domain Name:.*$', ''],
  },
  // registrantOrg sits under a >64-char parenthetical key (`Company English Name (It should
  // be the same as …)`) the tokenizer drops as prose — a bridge rule reads it
  regexFields: {
    registrantOrg: 'Registrant Contact Information:\\s*Company English Name.*:(.+)',
  },
  options: { dayFirst: true },
};
