// The one thing the library needs from a runtime: a way to open a TCP connection, and to
// upgrade it to TLS in place. Everything above this (SOCKS5, HTTP CONNECT, WHOIS, the
// tunnelled fetch) is written against these types and runs anywhere a transport exists.

// a two-way byte stream to a remote host
export interface Connection {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  // close both directions and release the socket. Safe to call more than once
  close(): Promise<void>;
  // upgrade to TLS in place, validating the server's certificate against `hostname`. The
  // connection it was called on must not be used afterwards
  startTls(hostname: string): Promise<Connection>;
}

export interface ConnectTarget {
  host: string;
  port: number;
}

export interface ConnectOptions {
  // how long to wait for the connection to open, in milliseconds
  timeout?: number;
  signal?: AbortSignal;
}

// opens a TCP connection. A transport is a function of this type
export type Connect = (target: ConnectTarget, options?: ConnectOptions) => Promise<Connection>;

// a proxy, as a URL or as a URL with settings. The URL's scheme says how the tunnel is
// asked for: socks5:// for SOCKS5, http:// or https:// for HTTP CONNECT
export type ProxySpec = string | { url: string; connectTimeout?: number };

// one proxy for both protocols, or one for each. A protocol with none goes direct
export type ProxyOption = ProxySpec | { whois?: ProxySpec; rdap?: ProxySpec };
