// The Node transport: TCP with node:net, and the TLS upgrade with node:tls. Bun and Deno
// run it through their Node compatibility. This is the only file in the library that may
// import a Node built-in.
import net from 'node:net';
import tls from 'node:tls';
import { ConnectionError, TimeoutError } from '../errors';
import type { Connect, Connection, ConnectOptions, ConnectTarget } from '../net/types';

export interface NodeTransportOptions {
  // the local address to connect from
  localAddress?: string;
  // extra options for the TLS upgrade, e.g. `ca` for a private certificate authority
  tls?: Pick<tls.ConnectionOptions, 'ca' | 'rejectUnauthorized' | 'minVersion'>;
}

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);

function toLibraryError(error: unknown, doing: string): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code && TIMEOUT_CODES.has(code)) {
    return new TimeoutError(`Timed out ${doing}`, { cause: error });
  }
  return new ConnectionError(`Failed ${doing}: ${message}`, { cause: error });
}

// a socket as a pair of web streams
function wrap(socket: net.Socket, describe: string, transport: NodeTransportOptions): Connection {
  let detached = false;
  let readableDone = false;

  const onData: { current?: (chunk: Buffer) => void } = {};
  const onEnd: { current?: () => void } = {};
  const onError: { current?: (error: Error) => void } = {};
  const onClose: { current?: () => void } = {};

  const readable = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const finish = (error?: Error) => {
          if (readableDone) return;
          readableDone = true;
          try {
            if (error) controller.error(error);
            else controller.close();
          } catch {
            // the stream was already cancelled
          }
        };
        onData.current = chunk => {
          if (readableDone) return;
          // copy: the stream's consumer may hold the bytes after Node reuses the buffer
          controller.enqueue(new Uint8Array(chunk));
          if ((controller.desiredSize ?? 0) <= 0) socket.pause();
        };
        onEnd.current = () => finish();
        onError.current = error => finish(toLibraryError(error, `reading from ${describe}`));
        // a close with no end is a connection that was cut
        onClose.current = () => finish();

        socket.on('data', onData.current);
        socket.on('end', onEnd.current);
        socket.on('error', onError.current);
        socket.on('close', onClose.current);
      },
      pull() {
        if (!detached) socket.resume();
      },
      cancel() {
        readableDone = true;
        if (!detached) socket.destroy();
      },
    },
    { highWaterMark: 1 }
  );

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        if (detached || socket.destroyed) {
          reject(new ConnectionError(`The connection to ${describe} is closed`));
          return;
        }
        socket.write(chunk, error =>
          error ? reject(toLibraryError(error, `writing to ${describe}`)) : resolve()
        );
      });
    },
    close() {
      return new Promise<void>(resolve => {
        if (detached || socket.destroyed) resolve();
        else socket.end(() => resolve());
      });
    },
    abort() {
      if (!detached) socket.destroy();
    },
  });

  // stop feeding the streams, leaving the socket open for whoever takes it over
  const detach = () => {
    detached = true;
    if (onData.current) socket.off('data', onData.current);
    if (onEnd.current) socket.off('end', onEnd.current);
    if (onError.current) socket.off('error', onError.current);
    if (onClose.current) socket.off('close', onClose.current);
  };

  return {
    readable,
    writable,
    close() {
      // destroy rather than end: a WHOIS or RDAP exchange is over when this is called, and
      // waiting for the other side to finish would hold the socket open
      if (!socket.destroyed) socket.destroy();
      return Promise.resolve();
    },
    startTls(hostname) {
      if (detached) {
        return Promise.reject(new ConnectionError('This connection was already upgraded'));
      }
      detach();
      return new Promise<Connection>((resolve, reject) => {
        const secure = tls.connect({
          ...transport.tls,
          socket,
          host: hostname,
          // an IP address is not a valid server name to send
          ...(net.isIP(hostname) ? {} : { servername: hostname }),
        });
        const onHandshakeError = (error: Error) => {
          secure.destroy();
          reject(toLibraryError(error, `the TLS handshake with ${hostname}`));
        };
        // the raw socket closing under the handshake, e.g. because close() was called
        const onRawClose = () => onHandshakeError(new Error('the connection closed'));
        secure.once('error', onHandshakeError);
        socket.once('close', onRawClose);
        secure.once('secureConnect', () => {
          secure.off('error', onHandshakeError);
          socket.off('close', onRawClose);
          resolve(wrap(secure, describe, transport));
        });
      });
    },
  };
}

// a TCP connect for this runtime, with settings that apply to every connection it opens
export function createConnect(transport: NodeTransportOptions = {}): Connect {
  return (target: ConnectTarget, options: ConnectOptions = {}) =>
    new Promise<Connection>((resolve, reject) => {
      const describe = `${target.host}:${target.port}`;
      const { signal, timeout } = options;
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
        return;
      }

      const socket = net.connect({
        host: target.host,
        port: target.port,
        ...(transport.localAddress ? { localAddress: transport.localAddress } : {}),
      });
      socket.setNoDelay(true);

      let settled = false;
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(
              () => fail(new TimeoutError(`Timed out connecting to ${describe}`)),
              timeout
            );
      const onAbort = () =>
        fail(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));

      const settle = () => {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        socket.off('error', onConnectError);
        socket.off('connect', onConnect);
      };
      function fail(error: Error) {
        if (settled) return;
        settle();
        socket.destroy();
        reject(error);
      }
      function onConnectError(error: Error) {
        fail(toLibraryError(error, `connecting to ${describe}`));
      }
      function onConnect() {
        if (settled) return;
        settle();
        resolve(wrap(socket, describe, transport));
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      socket.once('error', onConnectError);
      socket.once('connect', onConnect);
    });
}

// the default TCP connect on Node
export const connect: Connect = createConnect();
