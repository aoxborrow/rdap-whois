// .tc — registrar email under two `Customer Service Email` spellings.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarEmail: [
      'Registrar Customer Service Email',
      'Sponsoring Registrar Customer Service Email',
    ],
  },
};
