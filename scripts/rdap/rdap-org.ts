// rdap.org discovery source (docs/registry-health.md §10.4). rdap.org's curated router
// knows RDAP endpoints IANA hasn't bootstrapped: probe rdap.org/domain/nic.<tld> with a
// UA and capture the redirect target, then strip the query path to the base URL. This
// absorbs/expands M1's "stealth-RDAP probe". Signal only — the caller probe-verifies.
import { getRdapOrgRedirectUrl } from './redirect';
import { normalizeRdapServer } from '../../src/rdap/utils';
import type { DiscoverySource } from '../registry-health/discovery';

// rdap.org's no-redirect (404) path can take ~8-12s, and the webshare proxy exit adds
// variable latency (a positive redirect for a known TLD measured 673ms but occasionally
// spikes past 5s). Give it 12s so slow-but-real redirects aren't dropped as false nulls —
// most positive hits still resolve in well under a second.
const RDAP_ORG_TIMEOUT_MS = 12000;

export const rdapOrgSource: DiscoverySource = {
  name: 'rdap.org',
  async lookup(tld) {
    const url = await getRdapOrgRedirectUrl('domain', `nic.${tld}`, RDAP_ORG_TIMEOUT_MS);
    if (!url) return { servers: [] };
    // rdap.org redirects to `<base>/domain/nic.<tld>`; strip the query path to the base
    // and normalize to the same canonical form DnsServerCache routes by
    const base = normalizeRdapServer(url.replace(/domain\/nic\..+$/, ''));
    return { servers: base && base !== '/' ? [base] : [] };
  },
};
