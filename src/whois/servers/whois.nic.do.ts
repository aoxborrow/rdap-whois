// .do — registrar whois-server/email/address spellings.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarWhoisServer: ['WHOIS Server'],
    registrarEmail: ['Registrar Customer Service Email'],
    registrarAddress: ['Registrar Address'],
  },
};
