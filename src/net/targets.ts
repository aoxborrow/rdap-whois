import ipaddr from 'ipaddr.js';

// Which hosts the library may contact. This matters because RDAP referral links, WHOIS
// referral hostnames and redirect Location headers all come from a server's response, and
// without a check the library would connect wherever a response points.
//
// The check is on the name, not on the address it resolves to. A public-looking name that
// resolves to a private address (127.0.0.1.nip.io, or a name rebound between check and
// connect) gets through. Resolving here would not close that, since the transport resolves
// again when it connects, and an isomorphic library has no portable way to pin the address.
// A service that needs that guarantee should enforce it where the connection is made: in
// the `fetch` and `connect` it passes in, or with a network egress policy.

export interface PolicyTarget {
  protocol: 'whois' | 'rdap';
  host: string;
  port: number;
  /** the full URL, for RDAP */
  url?: string;
}

export interface TargetPolicy {
  /** query an http:// RDAP server as given instead of upgrading it to https. Default false */
  allowInsecure?: boolean;
  /**
   * allow IP literals, localhost and names that are only meaningful on a local network.
   * Default false
   */
  allowPrivate?: boolean;
  /** a further check of the caller's own. Returning false blocks the target */
  allow?: (target: PolicyTarget) => boolean;
}

export type TargetCheck<T> = { ok: true; target: T } | { ok: false; reason: string };

// names that never mean a public host
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/i;

// why a host may not be contacted, or null when it may
function hostProblem(host: string, policy: TargetPolicy): string | null {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (!name) return 'it has no host';

  const literal = name.replace(/^\[(.*)\]$/, '$1');
  if (ipaddr.isValid(literal)) {
    return policy.allowPrivate ? null : 'it is an IP address, not a hostname';
  }
  if (name === 'localhost' || PRIVATE_SUFFIXES.some(suffix => name.endsWith(suffix))) {
    return policy.allowPrivate ? null : 'it is a local name';
  }
  if (!HOSTNAME.test(name)) {
    // a single-label name is only resolvable on a local network
    if (policy.allowPrivate && /^[a-z0-9_-]{1,63}$/i.test(name)) return null;
    return 'it is not a valid public hostname';
  }
  return null;
}

// check a WHOIS server before connecting to it
export function checkWhoisTarget(
  host: string,
  port: number,
  policy: TargetPolicy = {}
): TargetCheck<{ host: string; port: number }> {
  const problem = hostProblem(host, policy);
  if (problem) return { ok: false, reason: `WHOIS server "${host}" is not allowed: ${problem}` };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: `WHOIS server "${host}" has an invalid port` };
  }
  const target = { protocol: 'whois' as const, host: host.toLowerCase(), port };
  if (policy.allow && !policy.allow(target)) {
    return { ok: false, reason: `WHOIS server "${host}" is not allowed by the target policy` };
  }
  return { ok: true, target: { host: target.host, port } };
}

// check an RDAP URL before requesting it, whether it came from the bootstrap data, a
// referral link or a redirect. Returns the URL to request: an http:// URL is upgraded to
// https:// unless the policy allows plain HTTP, so nothing is ever sent in the clear by
// default
export function checkRdapTarget(
  url: string | URL,
  policy: TargetPolicy = {}
): TargetCheck<{ url: string; host: string; port: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'RDAP URL is not a valid URL' };
  }
  const shown = `${parsed.protocol}//${parsed.host}`;

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `RDAP URL "${shown}" is not allowed: it is not an HTTP URL` };
  }
  // credentials in a URL from a response would be sent to whatever host it names
  if (parsed.username || parsed.password) {
    return { ok: false, reason: `RDAP URL "${shown}" is not allowed: it contains credentials` };
  }
  if (parsed.protocol === 'http:' && !policy.allowInsecure) {
    // an explicit port belongs to the plain-HTTP listener, so it cannot be kept
    parsed.port = '';
    parsed.protocol = 'https:';
  }

  const problem = hostProblem(parsed.hostname, policy);
  if (problem) return { ok: false, reason: `RDAP URL "${shown}" is not allowed: ${problem}` };

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  const target = { protocol: 'rdap' as const, host: parsed.hostname, port, url: parsed.href };
  if (policy.allow && !policy.allow(target)) {
    return { ok: false, reason: `RDAP URL "${shown}" is not allowed by the target policy` };
  }
  return { ok: true, target: { url: parsed.href, host: parsed.hostname, port } };
}
