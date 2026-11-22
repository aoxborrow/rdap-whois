// .hm — keyed `Domain expiration date: 28/04/2020` (day-first).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'labeled-blocks',
  aliases: { expirationDate: ['Domain expiration date'] },
  options: { dayFirst: true },
};
