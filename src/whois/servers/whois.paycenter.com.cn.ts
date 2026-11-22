// paycenter (Xin Net) — writes the contact postal keys with no space (`Admin PostalCode`/
// `Tech PostalCode`; the registrant keeps `Registrant Postal Code`), so the scope alias for
// `postal code` misses them.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'icann',
  aliases: { adminPostalCode: ['Admin PostalCode'], techPostalCode: ['Tech PostalCode'] },
};
