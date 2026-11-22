// .il (ISOC-IL) — RIPE-ish flat keys with day-first dates. creationDate lives in a dedicated
// `assigned: 01-11-2016` line, and techFax in the tech handle object's `fax-no:` — both ride
// the regexFields bridge (the first fax-no in document order is the tech contact's).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: { registrarUrl: ['registrar info'], expirationDate: ['validity'] },
  regexFields: {
    creationDate: 'assigned:\\s+([\\d-]+)',
    techFax: 'fax-no: *(.*)',
  },
  options: { dayFirst: true },
};
