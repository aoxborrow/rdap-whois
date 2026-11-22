// .za.net / .za.org (ZA NiC) — POSITIONAL contact blocks: the header line carries the
// name (`Registered for : Tavomi Rekasu`, `Administrative Contact : Name <email>`) and the
// indented bare lines below are address/city/state/postal/country/phone by POSITION. Blank
// lines separate blocks (default), so the trailing prose footer doesn't glue on. NS list
// under `Domain Name Servers listed in order:`.
import type { FormatConfig } from '../formats';

export const zaNic: FormatConfig = {
  format: 'block-scoped',
  // the NS list sits a blank line below its header; contact blocks are still delimited by the
  // next enumerated header, and nameserverFormatter drops the trailing prose (non-hostnames).
  blankLinesInBlocks: true,
  sectionHeaders: [
    'Registered for',
    'Administrative Contact',
    'Technical Contact',
    'Domain Name Servers listed in order',
  ],
  positionalTemplates: {
    'registered for': {
      scope: 'registrant',
      headerField: 'name',
      lines: ['address', 'city', 'postalCode', 'country'],
    },
    'administrative contact': {
      scope: 'admin',
      headerField: 'name',
      headerEmail: 'email',
      lines: ['org', 'address', 'city', 'state', 'postalCode', 'country', 'phone'],
    },
    'technical contact': {
      scope: 'tech',
      headerField: 'name',
      headerEmail: 'email',
      lines: ['org', 'address', 'city', 'state', 'postalCode', 'country', 'phone'],
    },
  },
  blockFields: { 'domain name servers listed in order': 'nameservers' },
  aliases: {
    domainName: ['Domain Name'],
    creationDate: ['Record Created'],
    updatedDate: ['Record Last Updated'],
  },
};
