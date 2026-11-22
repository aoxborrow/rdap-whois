import { describe, expect, it } from 'vitest';
import { formatConfig, resolveFormat } from '../../src/whois/formats';
import { getServerConfig } from '../../src/whois/servers';

// A renamed whois host (dk-hostmaster → punktum) must keep working for callers that
// still pass the OLD hostname explicitly: the old name resolves via WHOIS_SERVER_ALIASES
// to the canonical config (special query string) and parser, not the generic fallback.
describe('legacy whois server aliases', () => {
  it('resolves whois.dk-hostmaster.dk to the punktum config + special query string', () => {
    const legacy = getServerConfig('whois.dk-hostmaster.dk');
    const canonical = getServerConfig('whois.punktum.dk');
    expect(legacy.host).toBe('whois.punktum.dk');
    expect(legacy.queryString).toBe('--charset=utf-8 --show-handles $query');
    expect(legacy.queryString).toBe(canonical.queryString);
  });

  it('resolves the legacy host to the canonical server config under the new engine', () => {
    // without alias resolution the legacy name would fall back to the generic format and lose
    // punktum's Hostname/Postalcode aliases
    const legacy = formatConfig('whois.dk-hostmaster.dk');
    expect(legacy).toBeDefined();
    expect(legacy).toBe(formatConfig('whois.punktum.dk'));
    // and the derived format carries the punktum aliases end-to-end
    const format = resolveFormat('whois.dk-hostmaster.dk');
    expect(format.aliases.nameservers).toContain('Hostname');
  });

  it('leaves non-aliased servers untouched', () => {
    expect(getServerConfig('whois.verisign-grs.com').host).toBe('whois.verisign-grs.com');
  });
});
