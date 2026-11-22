import type { ProxyOption, ProxySpec } from './types';

// a proxy URL, taken apart
export interface ProxyConfig {
  // how to ask the proxy for a tunnel. `https` is HTTP CONNECT over a TLS connection to the proxy
  protocol: 'socks5' | 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
  // how long connecting to the proxy and getting a tunnel may take, in milliseconds
  connectTimeout?: number;
}

const SCHEMES: Record<string, { protocol: ProxyConfig['protocol']; port: number }> = {
  // the target's name always goes to the proxy to resolve, so socks5 and socks5h are the same
  'socks5:': { protocol: 'socks5', port: 1080 },
  'socks5h:': { protocol: 'socks5', port: 1080 },
  'socks:': { protocol: 'socks5', port: 1080 },
  'http:': { protocol: 'http', port: 80 },
  'https:': { protocol: 'https', port: 443 },
};

// a proxy URL with its credentials removed, for messages and events
export function redactProxy(spec: ProxySpec): string {
  const url = typeof spec === 'string' ? spec : spec.url;
  try {
    const parsed = new URL(url);
    if (!SCHEMES[parsed.protocol] || !parsed.host) return '<invalid proxy url>';
    const auth = parsed.username || parsed.password ? '***@' : '';
    return `${parsed.protocol}//${auth}${parsed.host}`;
  } catch {
    return '<invalid proxy url>';
  }
}

// read a proxy spec. Throws a TypeError for a URL that is not a usable proxy, which is a
// mistake in the caller's settings, not a failed request
export function parseProxy(spec: ProxySpec): ProxyConfig {
  const url = typeof spec === 'string' ? spec : spec.url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('The proxy is not a valid URL');
  }

  const scheme = SCHEMES[parsed.protocol];
  if (!scheme) {
    throw new TypeError(
      `Unsupported proxy scheme "${parsed.protocol.replace(/:$/, '')}": use socks5, http or https`
    );
  }
  // an IPv6 host is written in brackets in a URL
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!host) throw new TypeError('The proxy URL has no host');

  return {
    protocol: scheme.protocol,
    host,
    port: parsed.port ? Number(parsed.port) : scheme.port,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(typeof spec === 'object' && spec.connectTimeout !== undefined
      ? { connectTimeout: spec.connectTimeout }
      : {}),
  };
}

// the proxy to use for one protocol's requests, or undefined to go direct. Throws a
// TypeError for an option of neither shape
export function resolveProxy(
  option: ProxyOption | undefined,
  protocol: 'whois' | 'rdap'
): ProxyConfig | undefined {
  if (option === undefined || option === null) return undefined;
  if (typeof option === 'string') return parseProxy(option);
  if (typeof option !== 'object') {
    throw new TypeError('The proxy must be a URL, { url, connectTimeout } or { whois, rdap }');
  }
  if ('url' in option) return parseProxy(option);
  const spec = option[protocol];
  return spec ? parseProxy(spec) : undefined;
}
