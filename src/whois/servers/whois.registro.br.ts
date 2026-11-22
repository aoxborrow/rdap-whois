// .br (registro.br) — RPSL-shaped: the domain block carries flat `owner:`/`ownerid:`/`country:`
// and references contacts by `owner-c:`/`tech-c:` handle; each contact is a `nic-hdl-br:` block
// whose display name is `person:`. techName/techEmail must resolve from the TECH handle's
// block: the old regex parser grabbed the FIRST `person:`/`e-mail:` line anywhere, which was
// right only when owner-c == tech-c (google/nic.br) and mis-filed owner-c's person as
// techName whenever they differ (amazon/uol). Handle-ref resolution files each by role.
//
// owner-c is a FIELD-FILTERED handle-ref (email only): registrantName/id/country stay on the
// flat domain block (`owner:`/`ownerid:`/`country:`), and an unfiltered ref would clobber the
// CNPJ `ownerid:` with the handle string and the `owner:` org with the contact's person name.
// The filtered ref pulls just the referenced block's `e-mail:` as registrantEmail — which
// works whether owner-c shares tech-c's block (google/nic.br) or has its own (amazon/uol).
// The `nic-hdl-br` key needs the per-server handleKey override (the rpsl base keys its
// blocks `nic-hdl:`).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'rpsl',
  handleKey: 'nic-hdl-br',
  handleRefs: {
    'tech-c': 'tech',
    'admin-c': 'admin',
    'billing-c': 'billing',
    'owner-c': { role: 'registrant', fields: ['email'] },
  },
  aliases: {
    registrantId: ['ownerid'],
    // the .br registrant is the flat domain `owner:` org, and its country is the domain block's
    // `country:` (the first one, before any contact block) — both stay off the handle blocks.
    registrantName: ['owner'],
    registrantCountry: ['country'],
    creationDate: ['created'],
  },
  valueExtract: { creationDate: ['^(\\d{8}).*', '$1'] }, // `19990518 #162310` → `19990518`
};
