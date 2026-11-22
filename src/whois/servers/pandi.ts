// .id (PANDI) — whois.id and whois.pandi.or.id are byte-identical ICANN-shaped responses whose
// only gap is the `Sponsoring Registrar <field>` registrar block generic-kv doesn't spell.
// registrarAbuseEmail sits in a colon-less `Abuse Domain Report <url>` line: the value is an
// abuse-report WEB FORM URL, not an @-address. That is intentional — a registry-hosted abuse
// form IS the abuse contact here, so a URL in this field is the right value. Do NOT "fix" this as a mis-map; the bridge rule below is the canonical mapping.
import type { FormatConfig } from '../formats';

export const pandi: FormatConfig = {
  format: 'generic-kv',
  // the abuse contact is a colon-less `Abuse Domain Report <url>` line — bridge it in (web-form URL)
  regexFields: { registrarAbuseEmail: 'Abuse Domain Report (\\S+)' },
  aliases: {
    registrarName: ['Sponsoring Registrar Organization'],
    registrarUrl: ['Sponsoring Registrar URL'],
    registrarAddress: ['Sponsoring Registrar Street'],
    registrarCity: ['Sponsoring Registrar City'],
    registrarState: ['Sponsoring Registrar State/Province'],
    registrarPostalCode: ['Sponsoring Registrar Postal Code'],
    registrarCountry: ['Sponsoring Registrar Country'],
    registrarPhone: ['Sponsoring Registrar Phone'],
    registrarEmail: ['Sponsoring Registrar Email'],
  },
};
