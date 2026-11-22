// .at (NIC.AT) — RPSL objects: the domain object refs its contacts by `registrant:`/`tech-c:`
// handle, each contact is a `nic-hdl:` object with `personname:`/`street address:`/`fax-no:`
// fields. (Read as generic-kv, all of it would flatten into one multi-line registrarName.)
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'rpsl',
  handleRefs: { registrant: 'registrant' }, // tech-c is already an rpsl base handle-ref
  scopeAliases: { name: ['personname'] },
  // the domain object's `registrar:` carries a trailing profile link
  // (`Key-Systems GmbH ( https://nic.at/registrar/404 )`) — strip it to the bare name.
  valueExtract: { registrarName: [' *\\(\\s*https?://[^)]*\\)\\s*$', ''] },
};
