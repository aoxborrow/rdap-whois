import { describe, expect, it } from 'vitest';
import { DnsServerCache } from '../../src/rdap/cache/dns';
import { applyRdapLayer, type RdapRoutes } from '../../scripts/whois/generate-tlds';

const bases = (routes: RdapRoutes) =>
  Object.fromEntries(Object.entries(routes).map(([zone, { base }]) => [zone, base]));

describe('applyRdapLayer', () => {
  it('adds a route for a TLD the bootstrap does not cover, normalized', () => {
    const routes: RdapRoutes = {};
    applyRdapLayer(routes, { de: 'https://rdap.denic.de' }, 'overrides');
    // normalizeRdapServer lowercases, forces https, and adds one trailing slash
    expect(routes.de).toEqual({ base: 'https://rdap.denic.de/', source: 'overrides' });
  });

  it('replaces an existing bootstrap route (later layer wins)', () => {
    const routes: RdapRoutes = { app: { base: 'https://rdap.old.example/', source: 'iana' } };
    applyRdapLayer(routes, { app: 'https://rdap.new.example/' }, 'discovered');
    expect(routes.app).toEqual({ base: 'https://rdap.new.example/', source: 'discovered' });
  });

  it('upgrades http to https and collapses trailing slashes', () => {
    const routes: RdapRoutes = {};
    applyRdapLayer(routes, { ch: 'http://rdap.nic.ch///' }, 'overrides');
    expect(routes.ch.base).toBe('https://rdap.nic.ch/');
  });

  it('lowercases the TLD key', () => {
    const routes: RdapRoutes = {};
    applyRdapLayer(routes, { XN__: 'https://rdap.example/' }, 'overrides');
    expect(bases(routes)).toEqual({ xn__: 'https://rdap.example/' });
  });

  it('removes a route when the value is null (retract a dead bootstrap entry)', () => {
    const routes: RdapRoutes = { zz: { base: 'https://rdap.dead.example/', source: 'iana' } };
    applyRdapLayer(routes, { zz: null }, 'overrides');
    expect(routes.zz).toEqual({ base: null, source: 'overrides' });
  });

  it('applies discovered then overrides so the owner layer wins (bootstrap ← discovered ← overrides)', () => {
    const routes: RdapRoutes = { xx: { base: 'https://bootstrap.example/', source: 'iana' } };
    applyRdapLayer(routes, { xx: 'https://discovered.example/' }, 'discovered');
    applyRdapLayer(routes, { xx: 'https://owner.example/' }, 'overrides');
    expect(routes.xx).toEqual({ base: 'https://owner.example/', source: 'overrides' });
  });
});

describe('DnsServerCache', () => {
  it('routes bootstrap TLDs from the resolved table', () => {
    const cache = new DnsServerCache();
    // .com is always in the IANA bootstrap
    expect(cache.getServer('example.com')).toBeTruthy();
  });
});
