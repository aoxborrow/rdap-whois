// priv.at — the registrant org rides the RPSL `descr` key.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { registrantOrg: ['descr'] },
};
