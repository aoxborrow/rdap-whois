// The committed TLD map is codegen output: data/whois/tlds-*.json are the source layers,
// generated/whois/tlds.ts is what the live lookup flow actually routes by (servers.ts
// imports TLD_SERVERS from there). Nothing at runtime reads the JSON, so an edited layer
// that was never regenerated is INVISIBLE — prod keeps the old routing. The first test is
// that guard, the TLD-map twin of the servers registry lockstep test; the rest pin
// the two asymmetric null rules the merge depends on.
import { describe, expect, it } from 'vitest';
import { TLD_SERVERS } from '../../../src/whois/generated/tlds';
import tldsAscii from '../../../data/whois/tlds-ascii.json';
import tldsAuto from '../../../data/whois/tlds-auto.json';
import tldsDiscovered from '../../../data/whois/tlds-discovered.json';
import tldsExtra from '../../../data/whois/tlds-extra.json';
import tldsOverrides from '../../../data/whois/tlds-overrides.json';
import tldsPhaseout from '../../../data/whois/tlds-phaseout.json';
import { REGISTRY_ZONES } from '../../../src/whois/generated/zones';
import { getTldServers, mergeTldLayers, registryZones } from '../../../scripts/whois/generate-tlds';

describe('generated TLD map', () => {
  it('matches the source layers (regen: npm run whois:generate:tlds)', () => {
    expect(
      getTldServers(),
      'stale generated/whois/tlds.ts — run `npm run whois:generate:tlds`'
    ).toEqual(TLD_SERVERS);
    expect(
      registryZones(),
      'stale generated/whois/zones.ts — run `npm run whois:generate:tlds`'
    ).toEqual(REGISTRY_ZONES);
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
    for (const [tld, host] of Object.entries(tldsOverrides as Record<string, string | null>)) {
      expect(merged[tld], `override ${tld}`).toBe(host);
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
