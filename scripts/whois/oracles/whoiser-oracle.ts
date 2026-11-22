// whoiser oracle (docs/registry-health.md O2) — the zero-infrastructure oracle:
// whoiser's parseDomainWhois is a pure function (raw text → labeled fields) shipped on
// npm, so it runs in-process with no wrapper. Deliberately shallow parsing (generic
// key-value + a label-rename map, no per-registry logic), which is exactly why it's a
// COMPLETENESS voice only in the harness weighting.
//
// whoiser's package `exports` exposes only the client entry (whoiser.js); the pure
// parsers live in the sibling dist/parsers.js. Package-exports encapsulation applies to
// bare specifiers only, so we resolve the entry and import the sibling by file URL. The
// devDependency is pinned exact, so the dist layout can't shift under us.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { OracleResult } from './schema';

type WhoiserData = Record<string, unknown>;
type ParseDomainWhois = (domain: string, whois: string, ignorePrivacy?: boolean) => WhoiserData;

const require = createRequire(import.meta.url);
const parsersPath = require.resolve('whoiser').replace(/whoiser\.js$/, 'parsers.js');

let parserPromise: Promise<ParseDomainWhois> | null = null;
function loadParser(): Promise<ParseDomainWhois> {
  parserPromise ??= import(pathToFileURL(parsersPath).href).then(
    mod => (mod as { parseDomainWhois: ParseDomainWhois }).parseDomainWhois
  );
  return parserPromise;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;
const arr = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

// map whoiser's canonical labels (plus the ICANN labels it passes through un-renamed)
// onto the normalized oracle shape
export async function parseWithWhoiser(domain: string, raw: string): Promise<OracleResult> {
  const parse = await loadParser();
  const data = parse(domain, raw);
  return {
    // parseDomainWhois has no notfound/reserved signal — corpus mode only feeds it
    // found-lane fixtures, and the harness never counts whoiser on those flags
    notFound: false,
    reserved: false,
    fields: {
      domain_id: str(data['Registry Domain ID']),
      domain_name: str(data['Domain Name']),
      registrar_id: str(data['Registrar IANA ID'] ?? data['Registrar ID']),
      registrar_name: str(data['Registrar']),
      registrar_url: str(data['Registrar URL']),
      registrar_whois_server: str(data['Registrar WHOIS Server'] ?? data['Whois Server']),
      registrar_abuse_email: str(data['Registrar Abuse Contact Email']),
      registrar_abuse_phone: str(data['Registrar Abuse Contact Phone']),
      creation_date: str(data['Created Date']),
      updated_date: str(data['Updated Date']),
      expiration_date: str(data['Expiry Date']),
      dnssec: str(data['DNSSEC']),
      status: arr(data['Domain Status']),
      nameservers: arr(data['Name Server']),
      registrant_name: str(data['Registrant Name']),
      registrant_org: str(data['Registrant Organization']),
      registrant_email: str(data['Registrant Email']),
      registrant_country: str(data['Registrant Country']),
      admin_name: str(data['Admin Name']),
      admin_email: str(data['Admin Email']),
      tech_name: str(data['Tech Name']),
      tech_email: str(data['Tech Email']),
    },
  };
}

// Mine whoiser's `renameLabels` alias map straight out of its shipped source
// (docs/registry-health.md O2's one-off bonus): every "from" label it recognizes
// is a spelling some registry actually emits. The map is a function-local const, so it
// can't be imported — extract the pairs from the dist source text instead. Report-only
// tooling; if the layout drifts on an upgrade, the miner returns fewer pairs, never
// wrong ones.
export function mineWhoiserLabels(): Array<{ from: string; to: string }> {
  const source = readFileSync(parsersPath, 'utf8');
  const pairs: Array<{ from: string; to: string }> = [];
  const entry = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:\s*'([^']+)',/gm;
  for (const match of source.matchAll(entry)) {
    const from = match[1] ?? match[2] ?? match[3];
    const to = match[4];
    // keep only label→label renames (skip lineToGroup / noData / config entries)
    if (from && to && /^[A-Z]/.test(to)) pairs.push({ from, to });
  }
  return pairs;
}
