// .nc — numbered `Domain server <n>` nameservers. The count is unbounded (gouv.nc lists 6), so a
// fixed alias list would drop the tail; a regexField captures EVERY numbered line.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  regexFields: {
    nameservers: 'Domain server.*: *(.+)',
  },
};
