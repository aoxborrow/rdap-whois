// The `kaznic` format: KazNIC's KZ ccTLD output, the archetype of the COLON-LESS-HEADER
// cluster. KazNIC
// writes
//
//     Domain Name............: hoster.kz
//
//     Organization Using Domain Name
//     Name...................: Иванов Иван Иванович
//     Organization Name......: ТОО "Компания Hoster.KZ"
//     Street Address.........: Комиссарова, 45г, офис 405
//
//     Administrative Contact/Agent
//     NIC Handle.............: HOSTERKZ-22454
//     Email Address..........: hostmaster@hoster.kz
//
// where the ROLE lives in a section header that carries NO colon (`Organization Using Domain
// Name`), and the fields under it are dot-padded role-less sub-KVs (`Name...........:`). Two
// capabilities make this readable: the tokenizer's `sectionHeaders` (colon-less headers open a
// labeled block, blocks.ts) and mapping.ts `block-label` resolution — the same scoped-block
// machinery labeled-blocks uses, just reached through a different header lexeme. The dot-fill
// on keys needs nothing new: normalizeKey already strips a trailing `[.\s]+` run (mapping.ts).
//
// One thing is left as written: a status needs a `(\S+)(?=\s*-)` value transform the format
// model doesn't express, so `clientDeleteProhibited - status prevent …` stays whole. The
// format gives no techName (whois.nic.kz's config adds one); everything else — registrant +
// admin contacts, dates, nameservers, registrar — is read.
import { SCOPE_ALIASES } from '../aliases';
import type { AliasTable, ScopePrefix, WhoisFormat } from '../types';

// colon-less section header → contact scope. The SAME strings seed the tokenizer's
// sectionHeaders (below), so the two can't drift. Keyed here by their normalizeKey form
// (lower-case, collapsed whitespace) because mapping.ts matches on normalizeKey(block.label).
// `Registrant` and `Administrative Contact` are the spellings KazNIC answers with since 2026
const CONTACT_HEADERS: Record<string, ScopePrefix> = {
  'organization using domain name': 'registrant',
  'administrative contact/agent': 'admin',
  'registrant': 'registrant',
  'administrative contact': 'admin',
};

// the raw header spellings the tokenizer opens a block on (case-insensitive match)
const SECTION_HEADERS = [
  'Organization Using Domain Name',
  'Administrative Contact/Agent',
  'Registrant',
  'Administrative Contact',
];

// KazNIC's scoped-subfield spellings on top of the shared table: `id` from the block's
// `NIC Handle` (SCOPE_ALIASES omits id by design — here the handle IS a scoped key), and
// the `… Number` / `… Address` variants KazNIC uses for phone/fax/email/org.
const KAZNIC_SCOPE_ALIASES: AliasTable = {
  ...SCOPE_ALIASES,
  id: ['NIC Handle'],
  org: ['Organization Name', ...SCOPE_ALIASES.org],
  phone: ['Phone Number', ...SCOPE_ALIASES.phone],
  fax: ['Fax Number', ...SCOPE_ALIASES.fax],
  email: ['Email Address', ...SCOPE_ALIASES.email],
};

// domain-level fields, mapped from the un-headed blocks (the leading `Domain Name…` line, the
// `Primary/Secondary server` or `Name Server` list, the trailing dates/status/registrar).
// `Current Registar` keeps KazNIC's spelling; `Registar created` is intentionally left
// unmapped.
const KAZNIC_ALIASES: AliasTable = {
  domainName: ['Domain Name'],
  creationDate: ['Domain created'],
  updatedDate: ['Last modified'],
  expirationDate: ['Expiration date'],
  nameservers: ['Primary server', 'Secondary server', 'Name Server'],
  registrarName: ['Current Registar', 'Current Registrar'],
  eppStatus: ['Domain status'],
};

export const kaznicFormat: WhoisFormat = {
  name: 'kaznic',
  tokenizer: { sectionHeaders: SECTION_HEADERS },
  roleResolution: 'block-label',
  aliases: KAZNIC_ALIASES,
  scopeAliases: KAZNIC_SCOPE_ALIASES,
  blockScopes: CONTACT_HEADERS,
  blockFields: {},
  meta: {
    notfound: ['Nothing found for this query', 'No entries found'],
  },
};
