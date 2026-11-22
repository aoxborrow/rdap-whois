// .mobi/.in (Afilias-operated registries) — ICANN-ish; the registrar's IANA id rides in the
// `Sponsoring Registrar` value's parenthetical (`MarkMonitor Inc. (292)`, `Mark Monitor
// (R84-AFIN)`), aliased to registrarId then value-extracted (registrarName keeps the base
// spelling, with the ` (id)` stripped now that it's captured separately).
import type { FormatConfig } from '../formats';

export const sponsoringRegistrarId: FormatConfig = {
  format: 'generic-kv',
  aliases: { registrarId: ['Sponsoring Registrar'] },
  valueExtract: {
    registrarId: ['^.*\\(([^)]+)\\).*$', '$1'],
    registrarName: [' *\\(.*$', ''],
  },
};
