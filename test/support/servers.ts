// In-process servers for the library's network tests. Everything listens on 127.0.0.1 with
// a port the OS picks, so a test run never touches the network.
//
//   startWhoisServer   a port-43 responder that can also misbehave
//   startSocksProxy    a SOCKS5 proxy that tunnels to local servers, or refuses
//   startHttpProxy     an HTTP CONNECT proxy, likewise
//   startHttpServer    an HTTP or HTTPS responder for RDAP
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

// sockets a server has open, so close() can drop them instead of waiting for them
function track(server: net.Server): () => Promise<void> {
  const sockets = new Set<net.Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // a client that goes away mid-test is expected
    socket.on('error', () => {});
  });
  return () =>
    new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
  });
}

// a port with nothing listening on it
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

// ---------------------------------------------------------------------------------------
// WHOIS
// ---------------------------------------------------------------------------------------

export type WhoisReply =
  | string
  | Uint8Array
  | {
      // what to send
      text?: string | Uint8Array;
      // never answer and never close
      hang?: boolean;
      // send the text, then cut the connection with a reset instead of closing it
      reset?: boolean;
      // send the text and then keep the connection open
      stall?: boolean;
    };

export interface WhoisTestServer extends TestServer {
  // every query line received, in order
  queries: string[];
}

export async function startWhoisServer(
  respond: (query: string) => WhoisReply | Promise<WhoisReply>
): Promise<WhoisTestServer> {
  const queries: string[] = [];
  const server = net.createServer(socket => {
    let received = '';
    let answered = false;
    socket.on('data', chunk => {
      received += chunk.toString('latin1');
      const end = received.indexOf('\r\n');
      if (end === -1 || answered) return;
      answered = true;
      const query = received.slice(0, end);
      queries.push(query);

      void Promise.resolve(respond(query)).then(reply => {
        const options =
          typeof reply === 'string' || reply instanceof Uint8Array ? { text: reply } : reply;
        if (options.hang) return;
        if (options.reset) {
          // the reset follows the text after a pause: on Node 22 (libuv 1.51) a reset that
          // reaches the client together with the last data reads as a clean end of stream
          socket.write(options.text ?? '', () =>
            setTimeout(() => {
              if (!socket.destroyed) socket.resetAndDestroy();
            }, 50)
          );
          return;
        }
        if (options.stall) {
          socket.write(options.text ?? '');
          return;
        }
        socket.end(options.text ?? '');
      });
    });
  });
  const close = track(server);
  const port = await listen(server);
  return { host: '127.0.0.1', port, close, queries };
}

// ---------------------------------------------------------------------------------------
// SOCKS5
// ---------------------------------------------------------------------------------------

export interface ProxyTestOptions {
  // require this username and password
  username?: string;
  password?: string;
  // where a target name really is. Lets a test use a realistic hostname for a local server.
  // Default: connect to the name as given
  resolve?: (host: string, port: number) => { host: string; port: number };
  // SOCKS5: answer the connect request with this reply code instead of connecting, or with
  // the code this returns for the target (none: connect)
  reply?: number | ((host: string) => number | undefined);
  // HTTP CONNECT: answer with this status instead of connecting
  status?: number;
  // accept the connection and then say nothing
  hang?: boolean;
  // accept the connection and close it straight away
  drop?: boolean;
}

export interface ProxyTestServer extends TestServer {
  // every target a tunnel was asked for, in order
  requests: { host: string; port: number }[];
  // the credentials offered by each client, in order
  credentials: { username: string; password: string }[];
}

// read exactly `length` bytes from a socket
function readBytes(socket: net.Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onClose = () => reject(new Error('closed'));
    const attempt = () => {
      const chunk = socket.read(length) as Buffer | null;
      if (chunk) {
        socket.off('readable', attempt);
        socket.off('close', onClose);
        resolve(chunk);
      }
    };
    socket.on('readable', attempt);
    socket.once('close', onClose);
    attempt();
  });
}

function pipeTo(client: net.Socket, target: { host: string; port: number }, onOpen: () => void) {
  const upstream = net.connect(target.port, target.host);
  // a target that resets its connection resets the client's too
  upstream.on('error', () => client.resetAndDestroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  upstream.once('connect', () => {
    onOpen();
    client.pipe(upstream);
    upstream.pipe(client);
  });
}

export async function startSocksProxy(options: ProxyTestOptions = {}): Promise<ProxyTestServer> {
  const requests: ProxyTestServer['requests'] = [];
  const credentials: ProxyTestServer['credentials'] = [];
  const needsAuth = options.username !== undefined;

  const server = net.createServer(socket => {
    if (options.drop) return void socket.destroy();
    if (options.hang) return;

    void (async () => {
      const [, methodCount] = await readBytes(socket, 2);
      const methods = [...(await readBytes(socket, methodCount!))];

      if (needsAuth) {
        if (!methods.includes(0x02)) return void socket.end(Buffer.from([0x05, 0xff]));
        socket.write(Buffer.from([0x05, 0x02]));
        const [, userLength] = await readBytes(socket, 2);
        const username = (await readBytes(socket, userLength!)).toString();
        const [passLength] = await readBytes(socket, 1);
        const password = (await readBytes(socket, passLength!)).toString();
        credentials.push({ username, password });
        if (username !== options.username || password !== options.password) {
          return void socket.end(Buffer.from([0x01, 0x01]));
        }
        socket.write(Buffer.from([0x01, 0x00]));
      } else {
        socket.write(Buffer.from([0x05, 0x00]));
      }

      const [, , , type] = await readBytes(socket, 4);
      let host: string;
      if (type === 0x01) host = [...(await readBytes(socket, 4))].join('.');
      else if (type === 0x04) {
        const bytes = await readBytes(socket, 16);
        host = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2).toString(16)).join(
          ':'
        );
      } else {
        const [length] = await readBytes(socket, 1);
        host = (await readBytes(socket, length!)).toString();
      }
      const port = (await readBytes(socket, 2)).readUInt16BE(0);
      requests.push({ host, port });

      const reply = (code: number) => Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
      const code = typeof options.reply === 'function' ? options.reply(host) : options.reply;
      if (code !== undefined) return void socket.end(reply(code));

      const target = options.resolve?.(host, port) ?? { host, port };
      pipeTo(socket, target, () => socket.write(reply(0x00)));
    })().catch(() => socket.destroy());
  });

  const close = track(server);
  const port = await listen(server);
  return { host: '127.0.0.1', port, close, requests, credentials };
}

// ---------------------------------------------------------------------------------------
// HTTP CONNECT
// ---------------------------------------------------------------------------------------

export async function startHttpProxy(options: ProxyTestOptions = {}): Promise<ProxyTestServer> {
  const requests: ProxyTestServer['requests'] = [];
  const credentials: ProxyTestServer['credentials'] = [];

  const server = net.createServer(socket => {
    if (options.drop) return void socket.destroy();
    if (options.hang) return;

    let head = '';
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      socket.pause();

      const [requestLine = '', ...lines] = head.split('\r\n');
      const match = /^CONNECT (\S+):(\d+) HTTP\/1\.1$/.exec(requestLine);
      if (!match) return void socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      const host = match[1]!.replace(/^\[(.*)\]$/, '$1');
      const port = Number(match[2]);
      requests.push({ host, port });

      const authLine = lines.find(line => /^proxy-authorization:/i.test(line));
      if (authLine) {
        const encoded = authLine.split(' ').pop() ?? '';
        const [username = '', password = ''] = Buffer.from(encoded, 'base64').toString().split(':');
        credentials.push({ username, password });
      }
      if (options.username !== undefined) {
        const offered = credentials[credentials.length - 1];
        if (offered?.username !== options.username || offered.password !== options.password) {
          return void socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        }
      }
      if (options.status !== undefined) {
        return void socket.end(`HTTP/1.1 ${options.status} Test Status\r\n\r\n`);
      }

      const target = options.resolve?.(host, port) ?? { host, port };
      pipeTo(socket, target, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        socket.resume();
      });
    };
    socket.on('data', onData);
  });

  const close = track(server);
  const port = await listen(server);
  return { host: '127.0.0.1', port, close, requests, credentials };
}

// ---------------------------------------------------------------------------------------
// HTTP and HTTPS
// ---------------------------------------------------------------------------------------

export interface TestCertificate {
  // the hostname the certificate is for
  hostname: string;
  key: string;
  cert: string;
}

let certificate: TestCertificate | null | undefined;

// a self-signed certificate for a test hostname, made once per run with the openssl
// command. Null when openssl is not installed, so the TLS tests can skip themselves
export function testCertificate(): TestCertificate | null {
  if (certificate !== undefined) return certificate;
  const hostname = 'rdap.example.test';
  try {
    const dir = mkdtempSync(join(tmpdir(), 'rdap-whois-test-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        `/CN=${hostname}`,
        '-addext',
        `subjectAltName=DNS:${hostname}`,
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore' }
    );
    certificate = {
      hostname,
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8'),
    };
  } catch {
    certificate = null;
  }
  return certificate;
}

export interface HttpTestServer extends TestServer {
  // every request received, in order
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders }[];
}

export async function startHttpServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  tls?: TestCertificate
): Promise<HttpTestServer> {
  const requests: HttpTestServer['requests'] = [];
  const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      headers: request.headers,
    });
    handler(request, response);
  };
  const server = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, onRequest)
    : http.createServer(onRequest);
  const close = track(server);
  const port = await listen(server);
  return { host: '127.0.0.1', port, close, requests };
}
