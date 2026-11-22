// .si (ARNES) — `registrar-url` spelling; `registrant: <handle>` is the id (icann's bare
// `Registrant` alias would also fill registrantName with the handle), and the holder NAME lives
// in the trailing `Domain holder:` section — mapping it to registrantName at rank 0 both fixes
// the handle-as-name bug and keeps the real name/redaction placeholder.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarUrl: ['registrar-url'],
    registrantName: ['Domain holder'],
  },
};
