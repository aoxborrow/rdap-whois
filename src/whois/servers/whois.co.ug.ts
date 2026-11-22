// .ug (co.ug) — flat role-prefixed keys; generic-kv already reads most, the gap is
// `<role> State / Province` and the record-modification timestamp. updatedDate is
// `Information Last Updated`, NOT the
// `Renewed On` renewal date — those can differ by weeks.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    updatedDate: ['Information Last Updated'],
    registrantState: ['Registrant State / Province'],
    adminState: ['Admin State / Province'],
    techState: ['Tech State / Province'],
  },
};
