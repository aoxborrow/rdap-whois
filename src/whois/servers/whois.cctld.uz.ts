// .uz (cctld.uz) — an icann-style header section then a POSITIONAL contact section
// (`Registrant:`/`Administrative Contact:`/`Technical Contact:`/`Billing Contact:` with bare
// lines). Rebuilt on block-scoped (re-declaring the icann-ish domain aliases) + positional
// templates; valueExtract strips the `Tel. `/`Fax. ` phone prefix and the ` IP` off each NS.
import type { PositionalSlot } from '../types';
import type { FormatConfig } from '../formats';

const contactLines: PositionalSlot[] = [
  'name',
  { skip: true },
  'address',
  'city',
  // `Uzbekistan, 100011` — the postal digits are extracted below, all six of them
  'postalCode',
  'country',
  'phone',
  'fax',
];

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Administrative Contact', 'Technical Contact', 'Billing Contact'],
  positionalTemplates: {
    'registrant': { scope: 'registrant', lines: contactLines },
    'administrative contact': { scope: 'admin', lines: contactLines },
    'technical contact': { scope: 'tech', lines: contactLines },
    'billing contact': { scope: 'billing', lines: contactLines },
  },
  aliases: {
    domainName: ['Domain Name'],
    eppStatus: ['Status'],
    creationDate: ['Creation Date'],
    updatedDate: ['Updated Date'],
    expirationDate: ['Expiration Date'],
    registrarName: ['Registrar'],
    registrarUrl: ['Referral URL'],
    registrarWhoisServer: ['Whois Server'],
    nameservers: ['Name Server'],
  },
  valueExtract: {
    registrantPhone: ['^(?:Tel|Fax)\\. ', ''],
    adminPhone: ['^(?:Tel|Fax)\\. ', ''],
    techPhone: ['^(?:Tel|Fax)\\. ', ''],
    billingPhone: ['^(?:Tel|Fax)\\. ', ''],
    registrantPostalCode: ['^.*?,\\s*(\\d+)$', '$1'],
    adminPostalCode: ['^.*?,\\s*(\\d+)$', '$1'],
    techPostalCode: ['^.*?,\\s*(\\d+)$', '$1'],
    billingPostalCode: ['^.*?,\\s*(\\d+)$', '$1'],
    nameservers: [' .*', ''],
  },
};
