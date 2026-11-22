// whois.nic.st (ST Registry) writes a second, lowercase-HYPHENATED contact block under its
// ICANN-shaped header (`registrant-organization:`, `admin-street:`, …) that generic-kv's
// space-keyed table doesn't recognize — the role is still in the key, just `role-subfield`.
// Generate the 4×N aliases rather than hand-copy them (same reasoning as icann.ts).
import type { AliasTable } from '../types';
import type { FormatConfig } from '../formats';
import { scopedField } from '../fields';

const ST_HYPHEN_SUBFIELDS: Record<string, string> = {
  org: 'organization',
  name: 'name',
  address: 'street',
  city: 'city',
  state: 'state',
  postalCode: 'zip',
  country: 'country',
  phone: 'phone',
  fax: 'fax',
  email: 'email',
};

function stHyphenAliases(): AliasTable {
  const table: AliasTable = {
    creationDate: ['created-date'],
    updatedDate: ['updated-date'],
    expirationDate: ['expiration-date'],
    registrarUrl: ['URL'],
  };
  for (const role of ['registrant', 'admin', 'tech', 'billing']) {
    for (const [suffix, key] of Object.entries(ST_HYPHEN_SUBFIELDS)) {
      table[scopedField(role, suffix)] = [`${role}-${key}`];
    }
  }
  return table;
}

export const config: FormatConfig = { format: 'generic-kv', aliases: stHyphenAliases() };
