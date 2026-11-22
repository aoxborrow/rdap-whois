// .ac.uk (ja.net / JANET) — labeled-blocks bare bodies: `Registered For:`/`Domain Owner:` →
// registrant name/org, `Servers:` → NS, `Registrant Address:` positional (email shape-matched
// from the tail). registrantPhone carries a `(Phone)` marker, which the rule below leaves out.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blockFields: {
    'servers': 'nameservers',
    'registered for': 'registrantName',
    'domain owner': 'registrantOrg',
    // prose dates (`Tuesday 16th Jun 2026`) — parseDate strips the weekday's ordinal
    'entry created': 'creationDate',
    'entry updated': 'updatedDate',
    'renewal date': 'expirationDate',
  },
  positionalTemplates: {
    'registrant address': { scope: 'registrant', lines: [{ field: 'email', match: 'email' }] },
  },
  // ` +44 1509 222333 (Phone)` — the digits between `+` and `(Phone)`
  regexFields: { registrantPhone: '\\+([^\\n]+)\\s*\\(Phone\\)' },
};
