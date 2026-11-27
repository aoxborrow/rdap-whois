// data/tlds.json is codegen output: data/whois/tlds-*.json and data/rdap/dns*.json are the
// source layers, data/tlds.json is what the library actually routes by. Nothing at runtime
// reads the layers, so an edited layer that was never regenerated is INVISIBLE — prod keeps
// the old routing. The first test is that guard, the routing-table twin of the servers
// registry lockstep test; the rest pin the two asymmetric null rules the WHOIS merge depends
// on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tldsAscii from '../../../data/whois/tlds-ascii.json';
import tldsAuto from '../../../data/whois/tlds-auto.json';
import tldsDiscovered from '../../../data/whois/tlds-discovered.json';
import tldsExtra from '../../../data/whois/tlds-extra.json';
import tldsOverrides from '../../../data/whois/tlds-overrides.json';
import tldsPhaseout from '../../../data/whois/tlds-phaseout.json';
import dnsBootstrap from '../../../data/rdap/dns.json';
import { REGISTRY_ZONES } from '../../../src/whois/generated/zones';
import { RDAP_BOOTSTRAP_PUBLISHED } from '../../../src/generated/tlds-updated';
import {
  mergeTldLayers,
  registryZones,
  resolveTlds,
  serializeTlds,
} from '../../../scripts/whois/generate-tlds';
import { TLDS_FILE } from '../../../scripts/lib/paths';

describe('generated routing table', () => {
  it('matches the source layers (regen: npm run whois:generate:tlds)', () => {
    expect(
      readFileSync(TLDS_FILE, 'utf8'),
      'stale data/tlds.json — run `npm run whois:generate:tlds`'
    ).toBe(serializeTlds(resolveTlds()));
    expect(
      registryZones(),
      'stale generated/whois/zones.ts — run `npm run whois:generate:tlds`'
    ).toEqual(REGISTRY_ZONES);
    expect(
      RDAP_BOOTSTRAP_PUBLISHED,
      'stale src/generated/tlds-updated.ts — run `npm run whois:generate:tlds`'
    ).toBe(dnsBootstrap.publication.slice(0, 10));
  });

  it('names a source for every server it holds', () => {
    for (const [zone, route] of Object.entries(resolveTlds())) {
      expect(zone, 'zones are lowercase').toBe(zone.toLowerCase());
      if (route.whois) expect(route.whoisSource, zone).not.toBeNull();
      if (route.rdap) expect(route.rdapSource, zone).not.toBeNull();
      expect(route.whoisSource ?? route.rdapSource, `${zone} is named by no layer`).not.toBeNull();
    }
  });

  it('an auto null never unroutes a server the layers below still provide', () => {
    const base = mergeTldLayers({ includeOverrides: false });
    // IANA has dropped its `whois:` line for these, but the servers still answer, so the
    // static snapshot keeps them routed. Flattening `auto` into a plain spread would
    // unroute every one of them — that is the regression this pins. Derived from the raw
    // layers rather than pinned to a count: the phaseout layer legitimately nulls some of
    // these over time (128 went in one weekly run), so a threshold would rot
    const staticHosts: Record<string, string | null> = { ...tldsAscii, ...tldsExtra };
    const touchedAbove = new Set([...Object.keys(tldsDiscovered), ...Object.keys(tldsPhaseout)]);
    const saved = Object.entries(tldsAuto as Record<string, string | null>).filter(
      ([tld, host]) => host === null && staticHosts[tld] != null && !touchedAbove.has(tld)
    );
    expect(saved.length).toBeGreaterThan(0);
    for (const [tld] of saved) {
      expect(base[tld], `auto null unrouted ${tld}`).toBe(staticHosts[tld]);
    }
  });

  it('an override wins over every layer below it', () => {
    const base = mergeTldLayers({ includeOverrides: false });
    const merged = mergeTldLayers();
    const resolved = resolveTlds();
    for (const [tld, host] of Object.entries(tldsOverrides as Record<string, string | null>)) {
      expect(merged[tld], `override ${tld}`).toBe(host);
      expect(resolved[tld].whoisSource, `override ${tld}`).toBe('overrides');
    }
    // At least one override must actually deviate from the base, or the rule above is
    // vacuous — prune-overrides deletes any override the lower layers already reproduce,
    // so only deviating entries survive in the layer.
    const deviating = Object.entries(tldsOverrides as Record<string, string | null>).filter(
      ([tld, host]) => base[tld] !== host
    );
    expect(deviating.length).toBeGreaterThan(0);
  });
});
