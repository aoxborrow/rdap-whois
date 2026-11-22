import ipaddr from 'ipaddr.js';
import { ConnectionError, ProxyError } from '../errors';
import type { ConnectTarget } from './types';
import type { Wire } from './wire';

// SOCKS5 (RFC 1928) with username and password authentication (RFC 1929): ask a proxy for a
// TCP tunnel to a target. Written against Wire, so it runs on any transport.

const VERSION = 0x05;
const AUTH_NONE = 0x00;
const AUTH_PASSWORD = 0x02;
const AUTH_NONE_ACCEPTABLE = 0xff;
const COMMAND_CONNECT = 0x01;
const ADDRESS_IPV4 = 0x01;
const ADDRESS_DOMAIN = 0x03;
const ADDRESS_IPV6 = 0x04;

// reply codes that say the proxy tried and the target was the problem. Anything else is the
// proxy's own refusal
const TARGET_FAILURES: Record<number, string> = {
  0x03: 'network unreachable',
  0x04: 'host unreachable',
  0x05: 'connection refused',
  0x06: 'connection timed out',
};
const PROXY_FAILURES: Record<number, string> = {
  0x01: 'general failure',
  0x02: 'connection not allowed by the proxy',
  0x07: 'command not supported',
  0x08: 'address type not supported',
};

const encoder = new TextEncoder();

export interface SocksAuth {
  username?: string;
  password?: string;
}

function lengthPrefixed(text: string, what: string): Uint8Array {
  const bytes = encoder.encode(text);
  if (bytes.length > 255) throw new ProxyError(`The ${what} is too long for SOCKS5`);
  return Uint8Array.of(bytes.length, ...bytes);
}

// the target as SOCKS5 writes it: an address type, then the address
function encodeAddress(host: string): Uint8Array {
  if (ipaddr.isValid(host)) {
    const address = ipaddr.parse(host);
    const type = address.kind() === 'ipv4' ? ADDRESS_IPV4 : ADDRESS_IPV6;
    return Uint8Array.of(type, ...address.toByteArray());
  }
  // a name goes to the proxy as a name, so the proxy resolves it
  return Uint8Array.of(ADDRESS_DOMAIN, ...lengthPrefixed(host, 'target hostname'));
}

// ask the proxy on the other end of `wire` for a tunnel to `target`. Resolves once the
// tunnel is open; from then on the connection carries the target's bytes
export async function socks5Handshake(
  wire: Wire,
  target: ConnectTarget,
  auth: SocksAuth = {}
): Promise<void> {
  const withPassword = auth.username !== undefined || auth.password !== undefined;
  try {
    // offer the methods we can do
    const methods = withPassword ? [AUTH_NONE, AUTH_PASSWORD] : [AUTH_NONE];
    await wire.write(Uint8Array.of(VERSION, methods.length, ...methods));

    const [version, method] = await wire.read(2);
    if (version !== VERSION) {
      throw new ProxyError('The proxy did not answer as a SOCKS5 server');
    }
    if (method === AUTH_NONE_ACCEPTABLE) {
      throw new ProxyError(
        withPassword
          ? 'The proxy accepted none of the offered authentication methods'
          : 'The proxy requires authentication'
      );
    }

    if (method === AUTH_PASSWORD) {
      await wire.write(
        Uint8Array.of(
          0x01,
          ...lengthPrefixed(auth.username ?? '', 'proxy username'),
          ...lengthPrefixed(auth.password ?? '', 'proxy password')
        )
      );
      const [, status] = await wire.read(2);
      if (status !== 0x00) throw new ProxyError('The proxy rejected the username or password');
    } else if (method !== AUTH_NONE) {
      throw new ProxyError('The proxy chose an authentication method that was not offered');
    }

    // ask for the tunnel
    await wire.write(
      Uint8Array.of(
        VERSION,
        COMMAND_CONNECT,
        0x00,
        ...encodeAddress(target.host),
        target.port >> 8,
        target.port & 0xff
      )
    );
  } catch (error) {
    // the proxy closing on us mid-handshake is the proxy's failure, not the target's
    if (error instanceof ConnectionError) {
      throw new ProxyError(`The proxy closed the connection during the handshake`, {
        cause: error,
      });
    }
    throw error;
  }

  let reply: Uint8Array;
  try {
    reply = await wire.read(4);
    // the reply ends with the address the proxy bound, which nothing here needs
    const type = reply[3];
    if (type === ADDRESS_IPV4) await wire.read(4 + 2);
    else if (type === ADDRESS_IPV6) await wire.read(16 + 2);
    else if (type === ADDRESS_DOMAIN) await wire.read((await wire.read(1))[0] + 2);
  } catch (error) {
    if (error instanceof ConnectionError) {
      throw new ProxyError('The proxy closed the connection before opening the tunnel', {
        cause: error,
      });
    }
    throw error;
  }

  const code = reply[1] ?? 0x01;
  if (code === 0x00) return;

  const destination = `${target.host}:${target.port}`;
  const targetFailure = TARGET_FAILURES[code];
  if (targetFailure) {
    throw new ConnectionError(`Could not connect to ${destination}: ${targetFailure}`, {
      server: target.host,
      viaProxy: true,
    });
  }
  throw new ProxyError(
    `The proxy refused the tunnel to ${destination}: ${PROXY_FAILURES[code] ?? `reply code ${code}`}`,
    { server: target.host }
  );
}
