// .tw (TWNIC) — indented empty-value contact headers with a blank line then bare positional
// lines (name, email [shape], country). NS under `Domain servers in listed order:`. The
// `Record created on <date>` / `Record expires on <date>` lines are colon-less phrases mid-
// response, and the IDN responses put the contact's `(Redacted for privacy)` on a lone body
// line — both ride the regexFields bridge. The registrant's first body line is an org string,
// read as BOTH name and org — `name+org`.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  blankLinesInBlocks: true,
  sectionHeaders: [
    'Registrant',
    'Administrative Contact',
    'Technical Contact',
    'Domain servers in listed order',
  ],
  positionalTemplates: {
    'registrant': {
      scope: 'registrant',
      // email and country are shape-matched (position-free) so a registrant printed with BOTH a
      // Chinese name AND an English org line (2 leading lines, e.g. gamer/pchome/nic.tw) doesn't
      // slide the trailing country slot onto the English org — the real `TW` is the only 2-letter
      // line. name+org then takes the first remaining plain line.
      lines: [
        'name+org',
        { field: 'email', match: 'email' },
        { field: 'country', match: 'country' },
      ],
    },
    'administrative contact': { scope: 'admin', lines: ['name'] },
    'technical contact': { scope: 'tech', lines: ['name'] },
  },
  blockFields: { 'domain servers in listed order': 'nameservers' },
  aliases: {
    domainName: ['Domain Name'],
    eppStatus: ['Domain Status'],
    registrarName: ['Registration Service Provider'],
    registrarUrl: ['Registration Service URL'],
    registrarAbuseEmail: ['Registrar Abuse Contact Email'],
  },
  regexFields: {
    // full value incl. time + `(UTC+8)` — parseDate shifts the wall clock to the UTC instant
    creationDate: 'Record created on (.*)\\n',
    expirationDate: 'Record expires on (.*)\\n',
    adminEmail: '(?<=Administrative Contact:)\\s*.*  (.*)',
    techEmail: '(?<=Technical Contact:)\\s*.*  (.*)',
  },
};
