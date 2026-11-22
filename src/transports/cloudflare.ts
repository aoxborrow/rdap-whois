// The Cloudflare Workers transport: TCP with `connect()` from cloudflare:sockets.
//
// What works when deployed, as tried on Cloudflare: direct connections,
// and a SOCKS5 or HTTP CONNECT tunnel carrying a plain-TCP protocol such as WHOIS. TLS
// inside a tunnel does not: `startTls({ expectedServerHostname })` is honoured by local
// workerd and not in production, so a proxied RDAP request cannot be made from a Worker
// with the runtime's own TLS. The tunnelfetch package is the way round that.
//
// the reference pulls in the module's types for anything that compiles this file, including
// a consumer that reaches it from the library's source
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./cloudflare-sockets.d.ts" />
import { connect as openSocket, type Socket } from 'cloudflare:sockets';
import { ConnectionError, TimeoutError } from '../errors';
import type { Connect, Connection, ConnectOptions, ConnectTarget } from '../net/types';

function wrap(socket: Socket, describe: string): Connection {
  return {
    readable: socket.readable,
    writable: socket.writable,
    close: () => socket.close().catch(() => {}),
    startTls: hostname => {
      try {
        return Promise.resolve(
          wrap(socket.startTls({ expectedServerHostname: hostname }), describe)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.reject(
          new ConnectionError(`Failed the TLS handshake with ${hostname}: ${message}`, {
            cause: error,
          })
        );
      }
    },
  };
}

// the default TCP connect on Cloudflare Workers
export const connect: Connect = async (target: ConnectTarget, options: ConnectOptions = {}) => {
  const describe = `${target.host}:${target.port}`;
  const { signal, timeout } = options;
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Aborted');
  }

  // 'starttls' leaves the socket plain until startTls() is called, which is what both a
  // WHOIS exchange and a proxy handshake need
  const socket = openSocket(
    { hostname: target.host, port: target.port },
    { secureTransport: 'starttls', allowHalfOpen: false }
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => {
        if (timeout !== undefined) {
          timer = setTimeout(
            () => reject(new TimeoutError(`Timed out connecting to ${describe}`)),
            timeout
          );
        }
        onAbort = () =>
          reject(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    await socket.close().catch(() => {});
    if (error instanceof TimeoutError || signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ConnectionError(`Failed connecting to ${describe}: ${message}`, { cause: error });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }

  return wrap(socket, describe);
};
