// .aw — a `Domain nameservers:` labeled block of `host   ip` lines (nameserverFormatter
// keeps the hostname, drops the IP).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blockFields: { 'domain nameservers': 'nameservers' },
};
