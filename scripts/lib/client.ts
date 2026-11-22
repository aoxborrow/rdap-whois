// The library as the package's own tooling uses it: one client for the probes, the sweeps
// and the fixture recorders, going through a proxy when one is configured.
//
// Registries rate-limit datacenter addresses, so the scheduled health run goes through a
// rotating proxy. It is set from the environment, in either form:
//
//   RDAP_WHOIS_PROXY=http://user:pass@host:port       every request, both protocols
//   PROXY_USERNAME_DEFAULT=… PROXY_PASSWORD_DEFAULT=…  the rotating proxy the CI job uses:
//     WHOIS through its SOCKS5 side, RDAP through its HTTP CONNECT side, on PROXY_HOST
//     (default p.webshare.io) and PROXY_PORT (default 80)
//
// With neither set, requests go direct.
import { createProxyFetch } from '../../src/net/proxy-fetch';
import { parseProxy } from '../../src/net/proxy';
import { openConnection } from '../../src/net/tunnel';
import { RdapWhois, type ProxySpec, type RdapWhoisOptions } from '../../src/index';
import type { FetchLike } from '../../src/rdap/request';
import { connect } from '../../src/transports/node';

// the User-Agent every tooling request carries. rdap.org and some registries refuse a
// request without one
export const TOOLING_USER_AGENT = 'rdap-whois-tooling';

// how long the proxy may take to open a tunnel. A rotating exit to a distant registry is
// slow to connect but alive, so it gets more than a direct connection would need
const PROXY_CONNECT_TIMEOUT = 8_000;

// the proxy for one protocol, or undefined to go direct
export function toolingProxy(protocol: 'whois' | 'rdap'): ProxySpec | undefined {
  const single = process.env.RDAP_WHOIS_PROXY?.trim();
  if (single) return { url: single, connectTimeout: PROXY_CONNECT_TIMEOUT };

  const username = process.env.PROXY_USERNAME_DEFAULT?.trim();
  const password = process.env.PROXY_PASSWORD_DEFAULT?.trim();
  if (!username || !password) return undefined;
  const host = process.env.PROXY_HOST?.trim() || 'p.webshare.io';
  const port = process.env.PROXY_PORT?.trim() || '80';
  const scheme = protocol === 'whois' ? 'socks5' : 'http';
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  return { url: `${scheme}://${auth}@${host}:${port}`, connectTimeout: PROXY_CONNECT_TIMEOUT };
}

// the proxy URL with its credentials removed, for logs
export function describeProxy(protocol: 'whois' | 'rdap'): string {
  const spec = toolingProxy(protocol);
  if (!spec) return 'direct';
  const { protocol: scheme, host, port } = parseProxy(spec);
  return `${scheme}://${host}:${port}`;
}

// A client for the tooling. Probes ask one server and want its own answer, so a probe
// turns referrals off per call. The limits are the library's own (its defaults and the
// per-server table), which is what a batch job should keep to
export function toolingClient(options: RdapWhoisOptions = {}): RdapWhois {
  return new RdapWhois({
    userAgent: TOOLING_USER_AGENT,
    connect,
    proxy: { whois: toolingProxy('whois'), rdap: toolingProxy('rdap') },
    ...options,
  });
}

// A fetch for the RDAP probes, which read the HTTP exchange themselves (status codes,
// redirects, the raw body) rather than an interpreted hop: the runtime's fetch, or the
// library's tunnelled one when a proxy is configured. Redirects are never followed, so a
// probe sees each one
export function toolingFetch(timeout: number): FetchLike {
  const proxy = toolingProxy('rdap');
  if (!proxy) {
    return (url, init) => fetch(url, { ...init, redirect: 'manual' });
  }
  const config = parseProxy(proxy);
  const proxyFetch = createProxyFetch({
    open: (target, signal) => openConnection(target, { connect, proxy: config, timeout, signal }),
    timeout,
    maxResponseBytes: 5_000_000,
  });
  return (url, init) => proxyFetch(url, { headers: init.headers, signal: init.signal });
}
