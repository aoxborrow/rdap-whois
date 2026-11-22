// .no (NORID) — dot-padded `<role> Handle` keys that ARE the ids (normalizeKey strips the
// dot-fill). The referenced contact blocks aren't in the response, so only the handle-as-id
// + `Last updated` convert.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    domainId: ['NORID Handle'],
    registrarId: ['Registrar Handle'],
    techId: ['Tech-c Handle'],
    updatedDate: ['Last updated'],
  },
};
