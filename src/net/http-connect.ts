import { ConnectionError, ProxyError } from '../errors';
import type { ConnectTarget } from './types';
import type { Wire } from './wire';

// HTTP CONNECT: ask an HTTP proxy for a TCP tunnel to a target. Written against Wire, so it
// runs on any transport.

const HEADER_END = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);
const MAX_HEADER_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// statuses that mean the proxy tried and could not reach the target
const TARGET_FAILURES = new Set([502, 503, 504]);

export interface HttpProxyAuth {
  username?: string;
  password?: string;
}

// base64 of the UTF-8 bytes of a string, without Buffer
function base64(text: string): string {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// an IPv6 literal is written in brackets in an authority
const authority = (target: ConnectTarget): string =>
  `${target.host.includes(':') ? `[${target.host}]` : target.host}:${target.port}`;

// ask the proxy on the other end of `wire` for a tunnel to `target`. Resolves once the
// tunnel is open; from then on the connection carries the target's bytes
export async function httpConnectHandshake(
  wire: Wire,
  target: ConnectTarget,
  auth: HttpProxyAuth = {}
): Promise<void> {
  const destination = authority(target);
  const lines = [`CONNECT ${destination} HTTP/1.1`, `Host: ${destination}`];
  if (auth.username !== undefined || auth.password !== undefined) {
    lines.push(
      `Proxy-Authorization: Basic ${base64(`${auth.username ?? ''}:${auth.password ?? ''}`)}`
    );
  }

  let head: string;
  try {
    await wire.write(lines.join('\r\n') + '\r\n\r\n');
    head = decoder.decode(await wire.readUntil(HEADER_END, MAX_HEADER_BYTES));
  } catch (error) {
    // the proxy closing on us before it answers is the proxy's failure, not the target's
    if (error instanceof ConnectionError) {
      throw new ProxyError('The proxy closed the connection before opening the tunnel', {
        cause: error,
      });
    }
    throw error;
  }

  const match = /^HTTP\/1\.[01] (\d{3})(?: ([^\r\n]*))?/.exec(head);
  if (!match) throw new ProxyError('The proxy did not answer as an HTTP proxy');

  const status = Number(match[1]);
  if (status >= 200 && status < 300) return;

  const reason = match[2] ? ` ${match[2]}` : '';
  if (status === 407) {
    throw new ProxyError('The proxy rejected the username or password', { server: target.host });
  }
  if (TARGET_FAILURES.has(status)) {
    throw new ConnectionError(
      `Could not connect to ${destination}: the proxy answered ${status}${reason}`,
      { server: target.host, viaProxy: true }
    );
  }
  throw new ProxyError(
    `The proxy refused the tunnel to ${destination}: it answered ${status}${reason}`,
    { server: target.host }
  );
}
