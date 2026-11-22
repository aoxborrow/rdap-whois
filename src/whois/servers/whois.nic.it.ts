// .it (nic.it) — colon-less section headers (`Registrant`, `Admin Contact`,
// `Technical Contacts`, `Registrar`, `Nameservers`) + indented `Key: value` sub-fields and
// a bare-hostname NS list. `Web` → registrar url. registrarName is the block's
// `Organization:`, which SCOPE_ALIASES files as registrarOrg, so an alias moves it.
//
// foldContinuations back ON (block-scoped defaults it OFF): the contact blocks carry a
// multi-line `Address:` whose continuation lines are bare (no `Key:`). With folding off those
// bare lines are loose entries, and the block-label resolver fills the empty `*_name` from the
// first one — so a Registrant block that has `Organization:` but no `Name:` got
// registrantName = the city (e.g. "Pisa"/"Dublin"), which then won the domain-tool registrant
// display over the correct registrantOrg. Folding folds those lines back into `*_address`
// (now the full multi-line address) and leaves `*_name` empty where the block has no name.
// Safe here because .it names ALL its contact fields with explicit `Key:` sub-fields — unlike
// the bare-positional-name block-scoped servers (educause/amnic/twnic), where a real name IS a
// bare line and folding would delete it; those keep the default (off).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Admin Contact', 'Technical Contacts', 'Registrar', 'Nameservers'],
  foldContinuations: true,
  blockScopes: {
    'registrant': 'registrant',
    'admin contact': 'admin',
    'technical contacts': 'tech',
    'registrar': 'registrar',
  },
  blockFields: { nameservers: 'nameservers' },
  scopeAliases: { url: ['Web', 'Website', 'URL', 'www'] },
  aliases: {
    domainName: ['Domain'],
    eppStatus: ['Status'],
    dnssec: ['Signed'],
    creationDate: ['Created'],
    updatedDate: ['Last Update'],
    expirationDate: ['Expire Date'],
  },
};
