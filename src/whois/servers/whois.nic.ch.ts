// .ch (SWITCH) — `First registration date:` label with the value on the NEXT line (folded
// into the entry by the continuation rule).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { creationDate: ['First registration date'] },
};
