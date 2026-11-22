// .jp (JPRS) — two column-aligned, colon-less layouts share one server (keyValueSplit
// 'multispace'). The organizational forms (co.jp/ne.jp/…) letter-prefix each field
// (`a.` = Domain Name, `g.`/`d.` = Organization), carry contacts as handles, and put the
// expiry in the `[State]  Connected (2025/03/31)` parenthetical. The bare-.jp form (general
// use) drops the letter prefixes, spells the dates `[Created on]`/`[Last Updated]`/`[Expires on]`,
// and puts the registrant's own contact in a trailing `Contact Information` block — so both
// label spellings are aliased. That block maps to registrant* (its `[Name]` is the
// registrant's name, not an admin ID; the bare form has no separate admin/tech role).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  keyValueSplit: 'multispace',
  aliases: {
    domainName: ['a. [Domain Name]', '[Domain Name]'],
    registrantOrg: ['g. [Organization]', 'd. [Network Service Name]'],
    registrantName: ['[Registrant]', '[Name]'],
    registrantEmail: ['[Email]'],
    registrantPhone: ['[Phone]'],
    registrantFax: ['[Fax]'],
    adminId: ['m. [Administrative Contact]'],
    techId: ['n. [Technical Contact]'],
    nameservers: ['p. [Name Server]', '[Name Server]'],
    eppStatus: ['[Lock Status]', '[Status]'],
    creationDate: ['[Registered Date]', '[Created on]'],
    updatedDate: ['[Last Update]', '[Last Updated]'],
    // co.jp/ne.jp carry expiry in `[State] Connected (yyyy/mm/dd)`; bare .jp has a plain
    // `[Expires on] yyyy/mm/dd` — valueExtract pulls the parenthetical when present and
    // leaves the plain date untouched on a non-match.
    expirationDate: ['[State]', '[Expires on]'],
  },
  valueExtract: { expirationDate: ['^.*\\((\\d{4}/\\d{2}/\\d{2})\\).*$', '$1'] },
};
