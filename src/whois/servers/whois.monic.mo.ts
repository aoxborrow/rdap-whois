// .mo (monic) — labeled-blocks; `Domain name servers:` bare list. creation/expiration are
// colon-less `Record created on <date>` phrases mid-response — no key, no block, so they ride
// the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blockFields: { 'domain name servers': 'nameservers' },
  regexFields: {
    creationDate: 'Record created on (.*)\\n',
    expirationDate: 'Record expires on (.+?)\\n',
  },
};
