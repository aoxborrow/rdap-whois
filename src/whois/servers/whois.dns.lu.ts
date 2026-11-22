// .lu (dns.lu) — flat lowercase-hyphen keys (`domainname`, `registrar-name`, `org-country`).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  aliases: {
    domainName: ['domainname'],
    eppStatus: ['domaintype'],
    registrarName: ['registrar-name'],
    registrarUrl: ['registrar-url'],
    registrarCountry: ['registrar-country'],
    registrarEmail: ['registrar-email'],
    registrantCountry: ['org-country'],
  },
};
