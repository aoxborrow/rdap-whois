// .be (DNS Belgium) — plain `labeled-blocks` format.
//
// When a registrant opts out of publication, DNS Belgium prints the redaction boilerplate
// `Not shown, please visit www.dnsbelgium.be for webbased whois.` as the sole bare line under
// `Registrant:` — the block-label resolver would take it as registrantName. valueExtract blanks
// exactly that placeholder (a real `Name:` under the block is untouched) so the name stays empty.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  valueExtract: { registrantName: ['^Not shown, please visit.*', ''] },
};
