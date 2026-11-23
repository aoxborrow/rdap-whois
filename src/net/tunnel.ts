import {
  BlockedTargetError,
  ConnectionError,
  ProxyError,
  RdapWhoisError,
  TimeoutError,
} from '../errors';
import { isIpLiteral, isPublicAddress } from './addresses';
import { abortable, deadline } from './deadline';
import { httpConnectHandshake } from './http-connect';
import type { ProxyConfig } from './proxy';
import { socks5Handshake } from './socks5';
import type { Connect, Connection, ConnectTarget, Resolve } from './types';
import { Wire } from './wire';

export interface OpenOptions {
  // the runtime's TCP connect
  connect: Connect;
  // go through this proxy; undefined connects directly
  proxy?: ProxyConfig;
  // how long opening the connection may take, in milliseconds. A proxy's own
  // connectTimeout replaces it for the connection to the proxy and the handshake
  timeout: number;
  signal?: AbortSignal;
  // resolve the target's name here and connect only to the addresses it gives, refusing
  // the target unless every one of them is public. Undefined hands the name on as it is
  resolve?: Resolve;
}

// a connection that already has bytes read from it: hand those out first
function withPending(connection: Connection, pending: Uint8Array): Connection {
  if (!pending.length) return connection;
  const reader = connection.readable.getReader();
  let first = true;
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) {
        first = false;
        controller.enqueue(pending);
        return;
      }
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: reason => reader.cancel(reason),
  });
  return {
    readable,
    writable: connection.writable,
    close: () => connection.close(),
    // the bytes already read belong to the plain stream, so there is no clean point to
    // start TLS from
    startTls: () =>
      Promise.reject(
        new ConnectionError('The server sent data before the TLS handshake could start')
      ),
  };
}

// The addresses to connect to for `host`, IPv4 first. Every address the name resolves to
// must be public: a name with one private address among public ones is refused whole, since
// which one a connection would get is up to the resolver. The connection is then made to
// these addresses and never to the name, so the name cannot resolve somewhere else in between
async function publicAddresses(
  host: string,
  resolve: Resolve,
  signal: AbortSignal
): Promise<string[]> {
  const literal = host.replace(/^\[(.*)\]$/, '$1');
  if (isIpLiteral(literal)) {
    if (isPublicAddress(literal)) return [literal];
    throw new BlockedTargetError(`${host} is not a public address`, { server: host });
  }
  const addresses = await abortable(resolve(host, { signal }), signal);
  if (!addresses.length) throw new ConnectionError(`${host} has no addresses`, { server: host });
  const refused = addresses.find(address => !isPublicAddress(address));
  if (refused !== undefined) {
    throw new BlockedTargetError(`${host} resolves to ${refused}, which is not a public address`, {
      server: host,
    });
  }
  return [...addresses.filter(a => !a.includes(':')), ...addresses.filter(a => a.includes(':'))];
}

// Open a connection to `target`, directly or through a proxy tunnel. What comes back
// carries the target's bytes either way, and can be upgraded with startTls(target.host).
export async function openConnection(
  target: ConnectTarget,
  options: OpenOptions
): Promise<Connection> {
  const { connect, proxy, resolve, signal } = options;
  const destination = `${target.host}:${target.port}`;

  if (!proxy) {
    const limit = deadline(options.timeout, `Timed out connecting to ${destination}`, signal);
    try {
      if (!resolve)
        return await connect(target, { timeout: options.timeout, signal: limit.signal });
      // each address in turn, until one takes the connection. Each gets an equal share of
      // the time left, so one that drops the connection attempt cannot use it all up, and
      // time a quick failure leaves goes to the addresses still to try
      const ends = Date.now() + options.timeout;
      const addresses = await publicAddresses(target.host, resolve, limit.signal);
      let failure: unknown;
      for (const [index, host] of addresses.entries()) {
        const share = Math.floor((ends - Date.now()) / (addresses.length - index));
        try {
          return await connect(
            { host, port: target.port },
            { timeout: Math.max(1, share), signal: limit.signal }
          );
        } catch (error) {
          const another = error instanceof ConnectionError || error instanceof TimeoutError;
          if (limit.signal.aborted || !another) throw error;
          failure = error;
        }
      }
      throw failure;
    } finally {
      limit.clear();
    }
  }

  const timeout = proxy.connectTimeout ?? options.timeout;
  const limit = deadline(
    timeout,
    `Timed out waiting for the proxy to connect to ${destination}`,
    signal,
    { viaProxy: true }
  );

  // a tunnel through the proxy to one host and port
  const tunnel = async (to: ConnectTarget, within: AbortSignal): Promise<Connection> => {
    let connection: Connection | undefined;
    try {
      // reach the proxy. A failure here is the proxy's, whatever the transport called it
      try {
        connection = await connect(
          { host: proxy.host, port: proxy.port },
          { timeout, signal: within }
        );
        if (proxy.protocol === 'https') {
          connection = await abortable(connection.startTls(proxy.host), within);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof TimeoutError) {
          throw new ProxyError('Timed out connecting to the proxy', {
            cause: error,
            viaProxy: true,
          });
        }
        if (error instanceof RdapWhoisError) {
          throw new ProxyError(`Could not connect to the proxy: ${error.message}`, {
            cause: error,
          });
        }
        throw error;
      }

      // ask it for the tunnel
      const wire = new Wire(connection, within);
      try {
        const auth = { username: proxy.username, password: proxy.password };
        if (proxy.protocol === 'socks5') await socks5Handshake(wire, to, auth);
        else await httpConnectHandshake(wire, to, auth);
      } finally {
        // released whether or not the handshake worked, so close() below can end the streams
        connection = withPending(connection, wire.release());
      }
      return connection;
    } catch (error) {
      await connection?.close().catch(() => {});
      throw error;
    }
  };

  try {
    if (!resolve) return await tunnel(target, limit.signal);
    // the tunnel goes to an address checked here, so the proxy is never given a name to
    // resolve for itself. Checked before the proxy is reached, so a refused target costs no
    // connection. When the proxy cannot reach one address, or does not open the tunnel to
    // it within its share of the time left, the next is tried through it
    const ends = Date.now() + timeout;
    const addresses = await publicAddresses(target.host, resolve, limit.signal);
    let failure: unknown;
    for (const [index, host] of addresses.entries()) {
      const share = Math.floor((ends - Date.now()) / (addresses.length - index));
      const attempt = deadline(
        Math.max(1, share),
        `Timed out waiting for the proxy to connect to ${host}:${target.port}`,
        limit.signal,
        { viaProxy: true }
      );
      try {
        return await tunnel({ host, port: target.port }, attempt.signal);
      } catch (error) {
        const another = error instanceof ConnectionError || error instanceof TimeoutError;
        if (limit.signal.aborted || !another) throw error;
        failure = error;
      } finally {
        attempt.clear();
      }
    }
    throw failure;
  } finally {
    limit.clear();
  }
}
