// The library routes by the resolved table, data/tlds.json. Before it, the WHOIS table was a
// module generated from the layers and the RDAP layers were merged when the library loaded.
// Both are restated here from the layer files, exactly as they were, to prove the table
// routes every zone the layers name to the same servers
import { describe, expect, it } from 'vitest';
import tldsAscii from '../data/whois/tlds-ascii.json';
import tldsAuto from '../data/whois/tlds-auto.json';
import tldsDiscovered from '../data/whois/tlds-discovered.json';
import tldsExtra from '../data/whois/tlds-extra.json';
import tldsOverrides from '../data/whois/tlds-overrides.json';
import tldsPhaseout from '../data/whois/tlds-phaseout.json';
import dnsBootstrap from '../data/rdap/dns.json';
import dnsDiscovered from '../data/rdap/dns-discovered.json';
import dnsOverrides from '../data/rdap/dns-overrides.json';
import { normalizeServer } from '../src/common/utils';
import { IANA_WHOIS_SERVER } from '../src/whois/constants';
import { getRdapServerFromCache, getRdapSubZones, getRdapZone } from '../src/rdap/servers';
import { normalizeRdapServer } from '../src/rdap/utils';
import { getServerType, getTldServer, getTldZone, getWhoisServer } from '../src/whois/servers';
import { tldRoutes } from '../src/tlds';

type TldMap = Record<string, string | null>;

// the old generated WHOIS table
const merged: TldMap = { ...tldsAscii, ...tldsExtra };
for (const [tld, host] of Object.entries(tldsAuto as TldMap)) {
  if (host !== null || !(tld in merged)) merged[tld] = host;
}
Object.assign(merged, tldsDiscovered, tldsPhaseout, tldsOverrides);
const OLD_WHOIS: TldMap = Object.fromEntries(
  Object.entries(merged).map(([tld, host]) => [tld, host ? normalizeServer(host) : null])
);

// the old RDAP cache: the bootstrap, then the discovered and override layers
const OLD_RDAP = new Map<string, string>();
for (const [patterns, urls] of dnsBootstrap.services) {
  for (const pattern of patterns) OLD_RDAP.set(pattern, normalizeRdapServer(urls[0]));
}
for (const layer of [dnsDiscovered, dnsOverrides] as TldMap[]) {
  for (const [tld, url] of Object.entries(layer)) {
    if (url === null) OLD_RDAP.delete(tld.toLowerCase());
    else OLD_RDAP.set(tld.toLowerCase(), normalizeRdapServer(url));
  }
}

const oldWhoisZone = (domain: string): string | null => {
  while (domain.includes('.')) {
    domain = domain.substring(domain.indexOf('.') + 1);
    if (OLD_WHOIS[domain]) return domain;
  }
  return null;
};

const oldWhoisServer = (domain: string): string | null => {
  const zone = oldWhoisZone(domain);
  if (zone) return OLD_WHOIS[zone];
  return Object.hasOwn(OLD_WHOIS, domain.split('.').pop()!) ? null : IANA_WHOIS_SERVER;
};

const oldRdapZone = (query: string): string | null => {
  while (query.includes('.')) {
    query = query.substring(query.indexOf('.') + 1);
    if (OLD_RDAP.get(query)) return query;
  }
  return OLD_RDAP.get(query) ? query : null;
};

const ZONES = [...new Set([...Object.keys(OLD_WHOIS), ...OLD_RDAP.keys(), 'zzunknown'])];

describe('routing from data/tlds.json', () => {
  it('names every zone the layers name', () => {
    const zones = new Set([
      ...Object.keys(OLD_WHOIS),
      ...OLD_RDAP.keys(),
      ...Object.keys(dnsDiscovered),
      ...Object.keys(dnsOverrides),
    ]);
    expect(new Set(tldRoutes().map(([zone]) => zone))).toEqual(zones);
  });

  it('routes every zone to the WHOIS server the old table did', () => {
    expect(ZONES.length).toBeGreaterThan(1000);
    for (const zone of ZONES) {
      for (const query of [`example.${zone}`, `a.b.example.${zone}`]) {
        const zoneFound = oldWhoisZone(query);
        expect(getTldZone(query), query).toBe(zoneFound);
        expect(getTldServer(query), query).toBe(zoneFound ? OLD_WHOIS[zoneFound] : null);
        expect(getWhoisServer('domain', query), query).toBe(oldWhoisServer(query));
      }
    }
  });

  it('routes every zone to the RDAP base the old merge did', () => {
    for (const zone of ZONES) {
      for (const query of [`example.${zone}`, `a.b.example.${zone}`, zone]) {
        const zoneFound = oldRdapZone(query);
        expect(getRdapZone(query), query).toBe(zoneFound);
        expect(getRdapServerFromCache('domain', query), query).toBe(
          zoneFound ? OLD_RDAP.get(zoneFound) : null
        );
      }
    }
    expect(getRdapSubZones().sort()).toEqual(
      [...OLD_RDAP.keys()].filter(z => z.includes('.')).sort()
    );
  });

  it('counts every server the old table named as a registry server', () => {
    for (const host of new Set(Object.values(OLD_WHOIS))) {
      if (host && !host.includes('iana.org')) expect(getServerType(host), host).not.toBe('unknown');
    }
    expect(getServerType('whois.registrar.example')).toBe('unknown');
  });
});
