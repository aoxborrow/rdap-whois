// .pl (NASK) — mostly keyed, but the `REGISTRAR:` section is a bare positional block whose
// body lines contain colons (`Tel:`, `https://`), so it needs bare-body capture. Name + the
// address lines fill by position; phone/url/email are shape-matched from the tail (robust to
// a variable address-line count), then the `Tel: ` label and trailing url slash are stripped.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['REGISTRAR'],
  bareBodyHeaders: ['REGISTRAR'],
  // each `nameservers:` continuation is `hostN.pl. [1.2.3.4][2a02:…::5]`; the IPv6 colons make
  // the tokenizer read the continuation as its own key:value, defeating the fold. Strip the
  // bracketed IP annotations up front so the lines are bare hostnames that fold + list cleanly.
  preprocess: raw => raw.replace(/\[[^\]]*\]/g, ''),
  foldContinuations: true, // fold the top's multiline `nameservers:` list (NS2–4 continuations)
  blockScopes: { registrar: 'registrar' },
  positionalTemplates: {
    registrar: {
      scope: 'registrar',
      lines: [
        'name',
        'address',
        'address',
        'address',
        'address',
        { field: 'phone', match: 'phone' },
        { field: 'url', match: 'url' },
        { field: 'email', match: 'email' },
      ],
    },
  },
  aliases: {
    domainName: ['DOMAIN NAME'],
    creationDate: ['created'],
    updatedDate: ['last modified'],
    expirationDate: ['renewal date'],
    dnssec: ['dnssec'],
    nameservers: ['nameservers'],
    registrarWhoisServer: ['WHOIS database responses'],
  },
  valueExtract: {
    registrarPhone: ['^(?:[Tt]el|[Pp]hone)[.:]?\\s*', ''],
    registrarUrl: ['/+$', ''],
  },
};
