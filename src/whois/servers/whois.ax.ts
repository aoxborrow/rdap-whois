// .ax — dotted-fill keys (normalizeKey strips them); `www` is the registrar url.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarUrl: ['www'],
    registrantId: ['register number'],
    registrantName: ['name'],
    registrantEmail: ['holder email'],
  },
};
