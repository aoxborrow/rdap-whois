// .is (ISNIC) — RPSL objects: the domain object refs its contacts by `registrant:`/`admin-c:`/
// `tech-c:`/`billing-c:` handle, and each contact is a `nic-hdl:` object whose display name is
// `role:` (organisations) or `person:` (individuals). Without this config isnic fell to the
// generic-kv fallback, which surfaced the bare handle id as registrantName (`GL210-IS`, and
// `DP36-IS` where the person object clearly reads `Halvi Teporsson`) and dropped billingId.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'rpsl',
  // admin-c/tech-c are already rpsl base handle-refs; add the ISNIC registrant + billing keys
  handleRefs: { 'registrant': 'registrant', 'billing-c': 'billing' },
  // the contact object names itself with `role:` (org) or `person:` (base already has person)
  scopeAliases: { name: ['role', 'person'] },
};
