// Alias-table data + the merge rule shared across formats. The format files in ./formats/ import from here; nothing in this file is a
// format itself.
import type { AliasTable } from './types';

// Merge two alias tables preserving the collision rule: for each field, the base
// spellings keep priority and the extra spellings are appended after them, de-duped. Used
// by the formats that layer a small table over a larger one (generic-kv over icann,
// labeled-blocks over generic-kv) and by deriveFormat for per-server aliases.
export function mergeAliases(base: AliasTable, extra: AliasTable): AliasTable {
  const merged: AliasTable = { ...base };
  for (const [field, keys] of Object.entries(extra)) {
    merged[field] = [...new Set([...(merged[field] ?? []), ...keys])];
  }
  return merged;
}

// ── SCOPE_ALIASES: shared subfield table for the SCOPED formats ──
//
// block-label and handle-ref formats resolve a role-less key inside a role/section block
// (`Email:` under a `Registrant:` header, `e-mail:` under an AFNIC `nic-hdl:` block) to
// `${scope}_${suffix}` — so one table serves all four roles AND the registrar, instead of
// spelling out `registrantEmail`, `adminEmail`, … the way the flat icann table must.
//
// Suffix → source keys, ordered: the first key present wins. `id` is intentionally absent:
// a contact's id comes from the block's handle / the domain block's reference, never from
// a flat key inside the block.
export const SCOPE_ALIASES: AliasTable = {
  name: ['Name', 'contact', 'person', 'Contact Name'],
  org: ['Organization', 'Organisation', 'org', 'Company'],
  address: ['Street', 'Street Address', 'Address', 'addr', 'address'],
  city: ['City'],
  state: ['State/Province', 'State', 'Province'],
  postalCode: ['Postal Code', 'PostalCode', 'pcode', 'Zip code', 'Zip'],
  country: ['Country', 'country'],
  phone: ['Phone', 'phone', 'Voice'],
  fax: ['Fax', 'fax-no', 'Facsimile'],
  email: ['Email', 'e-mail', 'email', 'E-Mail'],
  // registrar-only in practice (there is no registrant_url field), harmless for the others
  url: ['Website', 'URL', 'url', 'www'],
};

// ── MINED_ALIASES: corpus-mined aliases ──
//
// These are REVIEWED DATA, not hand-guessed regexes and not a blind dump: an alias miner
// proposed every key below by observing that its raw value literally matched an expected field
// value on N distinct servers (and ONLY that field — the unique-value guard rejects the
// redaction strings that gTLDs repeat across contacts). This is the reviewed subset of that
// report (registry-health/alias-candidates.json) that is safe to adopt globally.
//
// "Reviewed" means each entry cleared two bars the miner can't fully judge on its own:
//   1. the key is NEW — absent from icann.ts / generic-kv.ts, so adding it can't turn a
//      firmly-mapped key (`e-mail` → registrantEmail) into a multi-field coin toss (the
//      miner's `conflicts` bucket — deliberately NOT folded here);
//   2. the key is NOT role-ambiguous. The miner also proposed `nic-hdl → techId` (4
//      servers), but nic-hdl is an RPSL/FRNIC handle whose role comes from its block, not
//      its key — it resolved to techId here only because the tech handle happened to be the
//      one that matched. Role-bearing handle keys belong to the per-format rpsl/fred
//      tables, not a global flat alias, so it is excluded.
//
// These merge into generic-kv AFTER the ICANN + non-ICANN spellings, so the collision rule
// keeps the canonical spelling's priority — a mined alias only wins when nothing better
// is present. Adding them changed no field the recorded found responses already parsed.
export const MINED_ALIASES: AliasTable = {
  // `Website: https://www.markmonitor.com` — registrar site under a plain label (7 servers)
  registrarUrl: ['Website'],
  // `Sponsoring Registrar Country: ID` — the sponsoring-registrar block's country (4 servers)
  registrarCountry: ['Sponsoring Registrar Country'],
  // AU-family "Contact ID" handles — value matched the role's expected id uniquely, and
  // likexian's keyRule corroborates `registrant contact id → registrantId` (3 servers each)
  registrantId: ['Registrant Contact ID'],
  techId: ['Tech Contact ID'],
  // `.es`/`.fr`-style "Ext." registrant fields (internationalized-domain extension block)
  registrantCountry: ['Registrant Ext. Country'],
  registrantOrg: ['Registrant Ext. Organization'],
};
