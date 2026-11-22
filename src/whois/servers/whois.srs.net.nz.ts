// whois.srs.net.nz (.nz, NZRS) writes a fully regular flat format with UNDERSCORE, role-
// prefixed keys (`registrant_contact_name`, `domain_dateregistered`, `ns_name_01`) — the role
// is in the key prefix (generic-kv's own key-prefix resolution), but generic-kv's SPACE-keyed
// aliases (`Registrant Name`) don't match the underscores, so every field drops. Generate the
// table from the regular shape rather than hand-listing 37 lines.
import type { AliasTable } from '../types';
import { scopedField } from '../fields';
import type { FormatConfig } from '../formats';

function nzAliases(): AliasTable {
  // canonical suffix → NZRS sub-key spelling
  const sub: Record<string, string> = {
    name: 'name',
    address: 'address1',
    city: 'city',
    state: 'province',
    postalCode: 'postalcode',
    country: 'country',
    phone: 'phone',
    fax: 'fax',
    email: 'email',
  };
  const table: AliasTable = {
    // the NZRS source key is spelled like our old field name; it is their spelling, not ours
    domainName: ['domain_name'],
    creationDate: ['domain_dateregistered'],
    expirationDate: ['domain_datebilleduntil'],
    updatedDate: ['domain_datelastmodified'],
    // nameservers arrive as ns_name_01, ns_name_02, … — enumerate a generous range
    nameservers: Array.from({ length: 20 }, (_, i) => `ns_name_${String(i + 1).padStart(2, '0')}`),
  };
  // canonical role → NZRS key prefix (registrar has no `_contact_` infix)
  const rolePrefix: Record<string, string> = {
    registrant: 'registrant_contact',
    admin: 'admin_contact',
    tech: 'technical_contact',
    registrar: 'registrar',
  };
  for (const [role, prefix] of Object.entries(rolePrefix)) {
    for (const [suffix, key] of Object.entries(sub)) {
      table[scopedField(role, suffix)] = [`${prefix}_${key}`];
    }
  }
  return table;
}

export const config: FormatConfig = { format: 'generic-kv', aliases: nzAliases() };
