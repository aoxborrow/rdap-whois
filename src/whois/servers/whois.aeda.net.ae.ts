// .ae (AEDA) — `Registrar ID` spelling; contacts are keyed `Registrant Contact Organisation`
// (British -isation, and prefixed `… Contact …`), which the base table doesn't carry.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarId: ['Registrar ID'],
    registrantOrg: ['Registrant Contact Organisation'],
    techOrg: ['Tech Contact Organisation'],
  },
};
