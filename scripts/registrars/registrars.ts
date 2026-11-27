// The registrar server list (registry-health/registrars.json): every ICANN-accredited
// registrar, keyed by its IANA registrar ID, with the RDAP base IANA lists for it, the WHOIS
// server it runs when one is known, and a domain a registry has confirmed it sponsors. The
// registrar lane of the registry-health run builds it (update-registrars.ts) and probes it (check-registrars.ts).
//
// IANA's registrar-ids registry carries the RDAP bases. WHOIS servers carry no ID anywhere, so
// each one is matched to the registrars it serves from evidence, a host and an ID seen together:
//   referral  a registry's answer for a domain names the sponsoring registrar's IANA ID and its
//             "Registrar WHOIS Server" (Verisign for .com and .net, and every thick gTLD)
//   self      a registrar server's own answer names the IANA ID of the registrar it speaks for
// A registry's answer that names an ID also confirms that registrar sponsors the domain, which
// makes the domain a good probe query for it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decode } from 'html-entities';
import { normalizeRdapServer } from '../../src/rdap/utils';
import { registrableDomain } from '../../src/registrable';
import { REGISTRARS_FILE, WHOIS_DATA_DIR, WHOIS_FIXTURES_DIR } from '../lib/paths';

export const IANA_REGISTRAR_IDS_URL =
  'https://www.iana.org/assignments/registrar-ids/registrar-ids.xml';

export type IanaRegistrar = { id: string; name: string; status: string; rdap: string | null };

export type RegistrarEntry = {
  name: string;
  rdap: string | null;
  whois: string | null;
  domain: string | null;
};

export type RegistrarList = {
  description: string;
  // the date of the IANA registry the list was built from
  updated: string;
  registrars: Record<string, RegistrarEntry>;
};

export type Evidence = {
  id: string;
  // the WHOIS server, when the answer named one
  host: string | null;
  kind: 'referral' | 'self';
  // the domain the answer was for; a referral confirms the registrar sponsors it
  domain: string;
  // asked this run, rather than read from the fixture corpus, which can be years old
  live: boolean;
};

const DESCRIPTION =
  'Every ICANN-accredited registrar by IANA registrar ID: its RDAP base from the IANA registrar-ids registry, the WHOIS server it runs when one is known (matched from registry referrals and its own answers), and a domain a registry confirmed it sponsors, used as the probe query. Built by npm run registrars:update; probed into registry-health/state.json under registrars.';

export function parseIanaRegistrars(xml: string): { updated: string; registrars: IanaRegistrar[] } {
  const updated = /<updated>([^<]+)<\/updated>/.exec(xml)?.[1] ?? '';
  const registrars: IanaRegistrar[] = [];
  for (const [, body] of xml.matchAll(/<record[^>]*>([\s\S]*?)<\/record>/g)) {
    const field = (tag: string): string | undefined =>
      new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(body)?.[1]?.trim();
    const id = field('value');
    if (!id || !/^\d+$/.test(id)) continue;
    const rdap = field('server');
    registrars.push({
      id,
      name: decode(field('name') ?? ''),
      status: field('status') ?? '',
      rdap: rdap ? normalizeRdapServer(rdap) : null,
    });
  }
  return { updated, registrars };
}

// a WHOIS server as answers write it ("whois://Whois.Example.com/", "whois.example.com:43")
// reduced to its hostname, or null when it is not one
export function normalizeHost(value: string | null | undefined): string | null {
  const host = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:].*$/, '')
    .replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host)) return null;
  return host;
}

// the IANA ID and WHOIS server a response names, from the ICANN-format lines
export function readRegistrarLines(raw: string): { id: string | null; host: string | null } {
  return {
    id: /^\s*Registrar IANA ID:\s*(\d+)\s*$/im.exec(raw)?.[1] ?? null,
    host: normalizeHost(/^\s*Registrar WHOIS Server:[ \t]*(\S*)/im.exec(raw)?.[1]),
  };
}

// one piece of evidence from a response `server` sent for `domain`. A registry's server (one
// that routes a TLD) names the sponsoring registrar; any other server is taken as a registrar's
// when its answer names an ID. A registry's own server named as the registrar's is dropped:
// some registries print theirs there
export function evidenceFrom(
  server: string,
  domain: string,
  raw: string,
  registryServers: Set<string>,
  live: boolean
): Evidence | null {
  const { id, host } = readRegistrarLines(raw);
  if (!id) return null;
  if (!registryServers.has(server)) return { id, host: server, kind: 'self', domain, live };
  return {
    id,
    host: host && !registryServers.has(host) ? host : null,
    kind: 'referral',
    domain,
    live,
  };
}

// the evidence the fixture corpus holds: every recorded answer, named <server>___<query>.txt
export function fixtureEvidence(registryServers: Set<string>): Evidence[] {
  const evidence: Evidence[] = [];
  for (const dir of ['found', 'reserved']) {
    const path = `${WHOIS_FIXTURES_DIR}${dir}/`;
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path)) {
      if (!file.endsWith('.txt')) continue;
      const [server, domain] = file.slice(0, -4).split('___');
      if (!server || !domain) continue;
      const raw = readFileSync(`${path}${file}`, 'utf8');
      const found = evidenceFrom(server, domain, raw, registryServers, false);
      if (found) evidence.push(found);
    }
  }
  return evidence;
}

// the registrar WHOIS servers the library already knew (data/whois/registrars.json)
export function seedHosts(): string[] {
  const hosts = JSON.parse(readFileSync(`${WHOIS_DATA_DIR}registrars.json`, 'utf8')) as string[];
  return [...new Set(hosts.map(normalizeHost).filter((h): h is string => Boolean(h)))].sort();
}

export function loadRegistrars(): RegistrarList {
  if (!existsSync(REGISTRARS_FILE))
    return { description: DESCRIPTION, updated: '', registrars: {} };
  return JSON.parse(readFileSync(REGISTRARS_FILE, 'utf8')) as RegistrarList;
}

export function saveRegistrars(list: RegistrarList): void {
  const registrars = Object.fromEntries(
    Object.entries(list.registrars).sort(([a], [b]) => Number(a) - Number(b))
  );
  const out: RegistrarList = { description: DESCRIPTION, updated: list.updated, registrars };
  writeFileSync(REGISTRARS_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

// Build the list: the accredited registrars from IANA, each with its RDAP base, a WHOIS server and
// a confirmed domain (the one on its own servers' domain first, then a gTLD one, since a
// registrar's WHOIS server rarely answers for a ccTLD). The WHOIS server is the one with
// the most live evidence, then one on the same domain as its RDAP base, then the most evidence
// of any age, then the earlier list's. A registrar with no evidence takes the server of the
// others on its RDAP base when they all name the same one on that base's domain: the drop-catch
// families (DropCatch on NameBright, Gname, Dynadot) run hundreds of accreditations on one
// platform. With neither, the earlier list's server stands
export function buildRegistrars(
  iana: IanaRegistrar[],
  evidence: Evidence[],
  previous: Record<string, RegistrarEntry>
): Record<string, RegistrarEntry> {
  const hostVotes = new Map<string, Map<string, { live: number; all: number }>>();
  const domains = new Map<string, Set<string>>();
  for (const e of evidence) {
    if (e.host) {
      const votes = hostVotes.get(e.id) ?? new Map<string, { live: number; all: number }>();
      const vote = votes.get(e.host) ?? { live: 0, all: 0 };
      vote.all++;
      if (e.live) vote.live++;
      votes.set(e.host, vote);
      hostVotes.set(e.id, votes);
    }
    if (e.kind === 'referral') {
      const set = domains.get(e.id) ?? new Set<string>();
      set.add(e.domain);
      domains.set(e.id, set);
    }
  }

  const registrars: Record<string, RegistrarEntry> = {};
  for (const { id, name, status, rdap } of iana) {
    if (status !== 'Accredited') continue;
    const before = previous[id];
    const rdapDomain = rdap ? registrableDomain(new URL(rdap).hostname) : null;
    const sameDomain = (host: string): number => Number(registrableDomain(host) === rdapDomain);
    const votes = [...(hostVotes.get(id) ?? new Map()).entries()].sort(
      ([a, x], [b, y]) =>
        y.live - x.live ||
        sameDomain(b) - sameDomain(a) ||
        y.all - x.all ||
        Number(b === before?.whois) - Number(a === before?.whois) ||
        a.localeCompare(b)
    );
    const whois = votes[0]?.[0] ?? null;
    const own = new Set([rdapDomain, whois && registrableDomain(whois)]);
    const gtld = (domain: string): number => Number(!/\.[a-z]{2}$/.test(domain));
    const confirmed = [...(domains.get(id) ?? [])].sort(
      (a, b) =>
        Number(own.has(b)) - Number(own.has(a)) ||
        gtld(b) - gtld(a) ||
        a.length - b.length ||
        a.localeCompare(b)
    );
    registrars[id] = { name, rdap, whois, domain: confirmed[0] ?? before?.domain ?? null };
  }

  const onBase = new Map<string, RegistrarEntry[]>();
  for (const entry of Object.values(registrars)) {
    if (entry.rdap) onBase.set(entry.rdap, [...(onBase.get(entry.rdap) ?? []), entry]);
  }
  for (const [base, entries] of onBase) {
    const hosts = new Set(entries.flatMap(e => (e.whois ? [e.whois] : [])));
    const [host] = hosts;
    if (hosts.size !== 1 || registrableDomain(host) !== registrableDomain(new URL(base).hostname)) {
      continue;
    }
    for (const entry of entries) entry.whois ??= host;
  }
  for (const [id, entry] of Object.entries(registrars)) entry.whois ??= previous[id]?.whois ?? null;
  return registrars;
}

export type Coverage = {
  accredited: number;
  whois: number;
  rdap: number;
  both: number;
  neither: number;
  whoisServers: number;
  rdapBases: number;
};

export function coverage(registrars: Record<string, RegistrarEntry>): Coverage {
  const entries = Object.values(registrars);
  return {
    accredited: entries.length,
    whois: entries.filter(r => r.whois).length,
    rdap: entries.filter(r => r.rdap).length,
    both: entries.filter(r => r.whois && r.rdap).length,
    neither: entries.filter(r => !r.whois && !r.rdap).length,
    whoisServers: new Set(entries.map(r => r.whois).filter(Boolean)).size,
    rdapBases: new Set(entries.map(r => r.rdap).filter(Boolean)).size,
  };
}
