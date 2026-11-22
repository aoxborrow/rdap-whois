// .li (SWITCH) — same `First registration date:` next-line label as .ch.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { creationDate: ['First registration date'] },
};
