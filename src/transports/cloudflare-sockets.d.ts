// The part of cloudflare:sockets the Workers transport uses, declared here so the library
// does not depend on @cloudflare/workers-types.
declare module 'cloudflare:sockets' {
  export interface SocketAddress {
    hostname: string;
    port: number;
  }

  export interface SocketOptions {
    secureTransport?: 'off' | 'on' | 'starttls';
    allowHalfOpen?: boolean;
  }

  export interface TlsOptions {
    expectedServerHostname?: string;
  }

  export interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    readonly opened: Promise<unknown>;
    readonly closed: Promise<void>;
    close(): Promise<void>;
    startTls(options?: TlsOptions): Socket;
  }

  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}
