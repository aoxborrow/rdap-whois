// .nu (Internetstiftelsen) — the `holder` handle is the registrant id.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { registrantId: ['holder'] },
};
