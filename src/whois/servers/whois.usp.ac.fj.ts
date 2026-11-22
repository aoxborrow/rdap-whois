// .fj (University of the South Pacific) — loose KV where the interesting values share
// lines with other tokens: `Domain Name: google.com.fj status: active` (the rules'
// `(\S+)` captures stop at the first whitespace) and nameservers are bare lines under a
// `Domain servers:` header. None of that is expressible as key→field aliases, so all
// three fields ride the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  regexFields: {
    domainName: 'Domain name:\\s+(\\S+)',
    eppStatus: '.*Status:\\s+(\\S+)',
    nameservers: 'Domain servers:\\n\\n((?:^[ \\t]+.*(?:\\r?\\n|$))+)',
  },
};
