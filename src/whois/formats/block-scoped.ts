// The `block-scoped` base format: a REUSABLE base
// for the colon-less/bracket-header block-label cluster, so a registry in it becomes a data-only
// per-server config instead of a bespoke format file. It carries the machinery (block-label
// resolution + the shared SCOPE_ALIASES) but NO section names or spellings of its own — a
// config supplies `sectionHeaders` (the colon-less/`[Bracket]` headers, merged into the
// tokenizer by deriveFormat), `blockScopes` (header → role), `scopeAliases` (the registry's
// localized subfield keys), and domain-level `aliases`. `.bo` (Spanish `TITULAR DEL DOMINIO`)
// and `.sn` (`[HOLDER]`/`[ADMIN_C]`) are the first two; both are pure configs on this base.
//
// Distinct from `labeled-blocks`, which opens sections on an empty-VALUE header
// (`Registrant:`); here the header carries no colon at all and is matched against an
// enumerated list (blocks.ts sectionHeaders). kaznic predates this base and stays its
// own file; new members ride the config path.
import { SCOPE_ALIASES } from '../aliases';
import type { WhoisFormat } from '../types';

export const blockScopedFormat: WhoisFormat = {
  name: 'block-scoped',
  // sectionHeaders are supplied per-server (deriveFormat merges config.sectionHeaders in);
  // foldContinuations off so each datum under a header is its own entry
  tokenizer: { foldContinuations: false },
  roleResolution: 'block-label',
  aliases: {},
  scopeAliases: SCOPE_ALIASES,
  blockScopes: {},
  blockFields: {},
};
