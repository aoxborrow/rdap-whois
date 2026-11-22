// .pt (dns.pt) — icann-shaped dates/status, plus `Owner <field>`/`Admin <field>` contact
// keys generic-kv doesn't spell (kept on the icann base so the DD/MM/YYYY dates stay tied).
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'icann',
  aliases: {
    registrantName: ['Owner Name'],
    registrantAddress: ['Owner Address'],
    registrantCity: ['Owner Locality'],
    registrantPostalCode: ['Owner ZipCode'],
    registrantCountry: ['Owner Country Code'],
    registrantEmail: ['Owner Email'],
    adminName: ['Admin Name'],
    adminAddress: ['Admin Address'],
    adminCity: ['Admin Locality'],
    adminPostalCode: ['Admin ZipCode'],
    adminCountry: ['Admin Country Code'],
    adminEmail: ['Admin Email'],
    nameservers: ['Name Server'],
  },
  // strip the ` | IPv4: … and IPv6: …` suffix so nameserverFormatter keeps the hostname
  valueExtract: { nameservers: [' *\\|.*', ''] },
};
