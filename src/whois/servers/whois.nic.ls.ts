// .ls (nic.ls) — fred/whoisd; no name field in the contact block, so one bridge rule files
// the `registrant:` HANDLE as registrantName.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'fred',
  regexFields: { registrantName: 'registrant: *(.+)' },
};
