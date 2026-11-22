// .nl (domain-registry.nl) — labeled-blocks; `Domain nameservers:` bare list. The registrar
// block's city/postal live on one combined `83642 Meridian` line and the country on the next —
// the split rides the regexFields bridge.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  blockFields: { 'domain nameservers': 'nameservers' },
  regexFields: {
    registrarPostalCode: 'Registrar:\\s*(?:.*\\n){2}\\s*(\\S*)\\s(?:.*)',
    registrarCity: 'Registrar:\\s*(?:.*\\n){2}\\s*(?:\\S*)\\s(.*)',
    registrarCountry: 'Registrar:\\s*(?:.*\\n){3}\\s*(.*)',
  },
};
