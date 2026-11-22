// .am (amnic) — POSITIONAL contact bodies under `Registrant:`/`Administrative contact:`/
// `Technical contact:` (org-first for registrant, name-first for contacts); email/phone
// shape-matched from the tail.
import type { FormatConfig } from '../formats';

export const config: FormatConfig = {
  format: 'block-scoped',
  sectionHeaders: ['Registrant', 'Administrative contact', 'Technical contact', 'DNS servers'],
  // the `DNS servers:` block lists each nameserver on its own indented line (absent when the
  // domain has none — nic.am prints "No name servers provided").
  blockFields: { 'dns servers': 'nameservers' },
  positionalTemplates: {
    // registrant body is org-first with no person line; that org string is read as
    // registrantName, and every trailing line into registrantAddress (no city/country
    // split, unlike the contacts) — so map line[0] → name and the rest → address (repeated
    // `address` slots append; surplus slots past the block's line count no-op).
    'registrant': { scope: 'registrant', lines: ['name', 'address', 'address', 'address'] },
    'administrative contact': {
      scope: 'admin',
      lines: ['name', 'org', 'address', 'city', 'country', { field: 'email', match: 'email' }],
    },
    'technical contact': {
      scope: 'tech',
      lines: ['name', 'org', 'address', 'city', 'country', { field: 'email', match: 'email' }],
    },
  },
  aliases: {
    domainName: ['Domain name'],
    eppStatus: ['Status'],
    registrarName: ['Registrar'],
    creationDate: ['Registered'],
    updatedDate: ['Last modified'],
    expirationDate: ['Expires'],
  },
};
