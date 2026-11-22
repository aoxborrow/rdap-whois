// .ar (NIC Argentina) — FRED-shaped handle-ref. The domain object names its registrant
// with `registrant: <handle>` and each contact is a `contact: <handle>` object carrying `name:`,
// so it resolves exactly like fred: `registered:` → creationDate (NOT the contact block's
// `created:`), the `contact:` block's `name:` → registrantName (the handle alone is the id).
// Dates are ISO (`1999-05-11 00:00:00`), so drop fred's day-first option.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'fred',
  options: { dayFirst: false },
};
