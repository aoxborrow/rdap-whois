// .lt (domreg.lt) — flat keys with a `Contact <field>` registrant + `Registrar website`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    registrarUrl: ['Registrar website'],
    registrantOrg: ['Contact organization'],
    registrantEmail: ['Contact email'],
  },
};
