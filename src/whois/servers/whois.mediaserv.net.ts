// .gf/.mq/.gp (mediaserv, JWhoisServer) — `[holder]`/`[admin_c]`/`[tech_c]` bracket headers
// (colon-less) + lowercase keyed sub-fields; SCOPE_ALIASES already covers name/address/
// pcode/country/phone/fax/email. Domain-level `domain`/`changed`/`nameserver`. The server
// writes `NO OBJECT FOUND!` in place of a contact it does not have, inside a domain's record,
// so its not-found is its own anchored pattern only (server-meta.ts), not ICANN's spellings.
import type { MetaKind } from '../types';
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  ownMetaOnly: ['notfound'] as MetaKind[],
  sectionHeaders: ['[holder]', '[admin_c]', '[tech_c]', '[billing_c]'],
  blockScopes: {
    '[holder]': 'registrant',
    '[admin_c]': 'admin',
    '[tech_c]': 'tech',
    '[billing_c]': 'billing',
  },
  aliases: {
    domainName: ['domain'],
    updatedDate: ['changed'],
    nameservers: ['nameserver'],
  },
  // the line that stands in for a missing contact is no name
  valueExtract: Object.fromEntries(
    ['registrantName', 'adminName', 'techName', 'billingName'].map(field => [
      field,
      ['^NO OBJECT FOUND!$', ''] as [string, string],
    ])
  ),
};
