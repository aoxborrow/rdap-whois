// .fi (Traficom) — dotted-fill keys (normalizeKey strips them); `www...: www.joker.com` under
// the Registrar section is the registrar url, schemed to https:// when the scheme is absent.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrantId: ['register number'],
    registrantName: ['name'],
    registrantPostalCode: ['postal'],
    registrarUrl: ['www'],
  },
  valueExtract: { registrarUrl: ['^(?!https?://)', 'https://'] },
};
