// .pf (registry.pf) — flat role-prefixed keys (`Registrant Name`, `Tech 1 City`,
// `Registrar Compagnie Name`, `Name server 1`) generic-kv's table doesn't spell. French
// day-first dates `01/03/2005`. domainName sits in a quoted prose line and stays lost.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'generic-kv',
  // domainName sits in the quoted prose line `Informations about 'mana.pf' :` — bridge rule
  regexFields: { domainName: "Informations about '([\\w\\.\\-]+)' :" },
  aliases: {
    eppStatus: ['Status'],
    creationDate: ['Created (JJ/MM/AAAA)'],
    updatedDate: ['Last renewed (JJ/MM/AAAA)'],
    expirationDate: ['Expire (JJ/MM/AAAA)'],
    nameservers: ['Name server 1', 'Name server 2', 'Name server 3', 'Name server 4'],
    registrarName: ['Registrar Compagnie Name'],
    registrantOrg: ['Registrant Compagnie Name'],
    registrantName: ['Registrant Name'],
    registrantAddress: ['Registrant Address'],
    registrantPostalCode: ['Registrant Postal Code'],
    registrantCity: ['Registrant City'],
    registrantState: ['Registrant Region / Island'],
    registrantCountry: ['Registrant Country'],
    techOrg: ['Tech 1 Compagnie Name'],
    techName: ['Tech 1 Name'],
    techAddress: ['Tech 1 Address'],
    techPostalCode: ['Tech 1 Postal Code'],
    techCity: ['Tech 1 City'],
    techState: ['Tech 1 Region / Island'],
    techCountry: ['Tech 1 Country'],
  },
  options: { dayFirst: true },
};
