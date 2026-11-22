// .uk (Nominet) — labeled-blocks; the `Registrar:` block's bare line carries the name AND
// the IANA tag (`Amazon.com, Inc. [Tag = AMAZON-COM]`). That line is split:
// registrarName stops at the bracket, the tag lifts to registrarId — fan the line to both
// and value-extract each side. Nameserver rows that carry glue addresses
// (`ns1.amzndns.co.uk  156.154.150.1  2001:502:...`) hit the tokenizer's first-colon split
// on the IPv6 address and leave the whole-block field, so nameservers ride the regexFields
// bridge (the shared nameserverFormatter strips the address columns).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blockFields: { registrar: 'registrarName+registrarId' },
  valueExtract: {
    registrarId: ['^.*\\[Tag *= *([^\\]]+)\\].*$', '$1'],
    registrarName: ['^([^\\[\\(]*[^\\[\\(\\s])\\s*[\\[\\(].*$', '$1'],
  },
  regexFields: {
    nameservers: 'Name servers:\\n *([\\n\\S\\s]+)',
    // `Registrant's address:` is a fixed positional block (street lines, then city, postcode,
    // country), read by counting lines (only nic.uk/gov.uk-style records carry a registrant block —
    // most .uk records are privacy-redacted and have none).
    registrantAddress: "Registrant's address:\\s*(?:.*\\n){2}\\s+(.*)",
    registrantCity: "Registrant's address:\\s*(?:.*\\n){3}\\s+(.*)",
    registrantCountry: "Registrant's address:\\s*(?:.*\\n){5}\\s+(.*)",
  },
};
