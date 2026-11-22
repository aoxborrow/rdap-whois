import { ConnectionError, ProxyError, TimeoutError, RdapWhoisError } from '../errors';
import { abortable, deadline } from './deadline';
import { httpConnectHandshake } from './http-connect';
import type { ProxyConfig } from './proxy';
import { socks5Handshake } from './socks5';
import type { Connect, Connection, ConnectTarget } from './types';
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

// Open a connection to `target`, directly or through a proxy tunnel. What comes back
// carries the target's bytes either way, and can be upgraded with startTls(target.host).
export async function openConnection(
  target: ConnectTarget,
  options: OpenOptions
): Promise<Connection> {
  const { connect, proxy, signal } = options;
  const destination = `${target.host}:${target.port}`;

  if (!proxy) {
    const limit = deadline(options.timeout, `Timed out connecting to ${destination}`, signal);
    try {
      return await connect(target, { timeout: options.timeout, signal: limit.signal });
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
  let connection: Connection | undefined;
  try {
    // reach the proxy. A failure here is the proxy's, whatever the transport called it
    try {
      connection = await connect(
        { host: proxy.host, port: proxy.port },
        { timeout, signal: limit.signal }
      );
      if (proxy.protocol === 'https') {
        connection = await abortable(connection.startTls(proxy.host), limit.signal);
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
    const wire = new Wire(connection, limit.signal);
    try {
      const auth = { username: proxy.username, password: proxy.password };
      if (proxy.protocol === 'socks5') await socks5Handshake(wire, target, auth);
      else await httpConnectHandshake(wire, target, auth);
    } finally {
      // released whether or not the handshake worked, so close() below can end the streams
      connection = withPending(connection, wire.release());
    }
    return connection;
  } catch (error) {
    await connection?.close().catch(() => {});
    throw error;
  } finally {
    limit.clear();
  }
}
