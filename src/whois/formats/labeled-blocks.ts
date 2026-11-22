// The `labeled-blocks` format: the indented section-header family, beyond icann/generic-kv.
// eurid (.eu),
// Nominet (.uk), and the counted-newline-hack ccTLDs all write
//
//     Registrar:
//             Name: Markmonitor Inc.
//             Website: https://www.markmonitor.com/
//     Name servers:
//             ns1.example.com
//
// where the ROLE/FIELD lives in the section header and the entries under it are role-less
// (a sub-KV like `Name:`, or a bare value like a hostname). This is exactly what the flat
// formats can't read — an empty-value header is lexically identical to a redacted ICANN
// field — so it needs the tokenizer's `empty-value` mode plus mapping.ts `block-label`
// resolution.
import { GENERIC_KV_ALIASES } from './generic-kv';
import { SCOPE_ALIASES, mergeAliases } from '../aliases';
import type { AliasTable, WhoisFormat } from '../types';

// scope-less section bodies whose date/status spellings the domain-level table must know
// (they arrive as sub-KVs under `Relevant dates:` / `Registration status:`, mapped
// globally because those headers carry no scope).
const LABELED_GLOBALS: AliasTable = {
  creationDate: ['Registered on', 'Registered', 'Registration date'],
  expirationDate: ['Expiry date', 'Renewal date'],
  updatedDate: ['Last updated', 'Last modified'],
};

export const LABELED_BLOCKS_ALIASES = mergeAliases(GENERIC_KV_ALIASES, LABELED_GLOBALS);

export const labeledBlocksFormat: WhoisFormat = {
  name: 'labeled-blocks',
  // the defining switch: an empty-value line opens a section (blocks.ts), and bare lines
  // under it are captured as keyless entries. foldContinuations off so each bare line (each
  // nameserver) is its own entry rather than gluing onto the previous.
  tokenizer: { blockLabels: 'empty-value', foldContinuations: false },
  roleResolution: 'block-label',
  aliases: LABELED_BLOCKS_ALIASES,
  scopeAliases: SCOPE_ALIASES,
  // normalized section header → scope prefix (contacts + registrar)
  blockScopes: {
    'registrant': 'registrant',
    'holder': 'registrant',
    'registrar': 'registrar',
    'admin': 'admin',
    'administrative': 'admin',
    'administrative contact': 'admin',
    'tech': 'tech',
    'technical': 'tech', // EURID (.eu) heads its contact sections `Technical:` / `Registrant:`
    'technical contact': 'tech',
  },
  // normalized section header → whole-block field (bare-value / list sections)
  blockFields: {
    'domain': 'domainName',
    'domain name': 'domainName',
    'name servers': 'nameservers',
    'name server': 'nameservers',
    'nameservers': 'nameservers',
    'nserver': 'nameservers',
    'dnssec': 'dnssec',
    'status': 'eppStatus',
    'registration status': 'eppStatus',
    'domain status': 'eppStatus',
  },
  meta: {
    notfound: [
      '^\\s*No match for ',
      '^\\s*This domain name has not been registered',
      '^\\s*Not registered',
    ],
  },
};
