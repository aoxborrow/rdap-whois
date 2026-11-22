// .edu (EDUCAUSE) — POSITIONAL bodies under `Registrant:`/`Administrative Contact:`/
// `Technical Contact:`: registrant starts at org (no name line), contacts start at name;
// the `City, ST ZIP` line is skipped, and phone/email are shape-matched from the tail so a
// missing line can't shift them: a positional reading would file a phone as the country.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Administrative Contact', 'Technical Contact', 'Name Servers'],
  blockFields: { 'name servers': 'nameservers' },
  positionalTemplates: {
    // registrant is an institution — line 1 is both the name and the organization (there is no person line; likexian + weppos both file it as org)
    'registrant': {
      scope: 'registrant',
      lines: ['name+org', 'address', { skip: true }, 'country'],
    },
    'administrative contact': {
      scope: 'admin',
      lines: [
        'name',
        'org',
        'address',
        { skip: true },
        'country',
        { field: 'phone', match: 'phone' },
        { field: 'email', match: 'email' },
      ],
    },
    'technical contact': {
      scope: 'tech',
      lines: [
        'name',
        'org',
        'address',
        { skip: true },
        'country',
        { field: 'phone', match: 'phone' },
        { field: 'email', match: 'email' },
      ],
    },
  },
  aliases: {
    domainName: ['Domain Name'],
    creationDate: ['Domain record activated'],
    updatedDate: ['Domain record last updated'],
    expirationDate: ['Domain expires'],
  },
};
