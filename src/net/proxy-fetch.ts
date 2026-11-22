import { ConnectionError, InvalidResponseError } from '../errors';
import { abortable, deadline } from './deadline';
import type { Connection, ConnectTarget } from './types';
import { concatBytes, Wire } from './wire';

// A fetch for the one thing RDAP needs, over a connection the library opened itself: a GET
// that returns a JSON body. It exists so an RDAP request can go through a proxy tunnel on
// Node, Bun and Deno, where the runtime's own fetch has no proxy option but its TLS works
// inside a tunnel.
//
// It is not the `tunnelfetch` npm package and does not replace it. On Cloudflare Workers
// the runtime cannot verify a tunnelled peer, so this cannot work there; that package does
// TLS itself, and a Worker passes its client as the library's `fetch` option.
//
// It speaks HTTP/1.1 with `Connection: close`: one request per connection, no pooling, no
// HTTP/2. It does not follow redirects; a 3xx comes back as it is, so the caller can check
// each hop and send it through the proxy too.

const HEADER_END = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);
const LINE_END = Uint8Array.of(0x0d, 0x0a);
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_CHUNK_LINE_BYTES = 1024;
// how many 1xx responses to read past before giving up on a server
const MAX_INFORMATIONAL_RESPONSES = 5;
// statuses that never carry a body
const NO_BODY = new Set([204, 205, 304]);
const decoder = new TextDecoder();

export interface ProxyFetchOptions {
  // open a connection to a host and port, directly or through a proxy
  open: (target: ConnectTarget, signal?: AbortSignal) => Promise<Connection>;
  // how long the request may take once the connection is open, in milliseconds
  timeout: number;
  // the largest body to accept, before and after decompression
  maxResponseBytes: number;
}

export interface ProxyFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ProxyFetch = (url: string | URL, init?: ProxyFetchInit) => Promise<Response>;

// a header value must not be able to end the line and start another header
function headerLine(name: string, value: string): string {
  if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
    throw new TypeError(`Invalid characters in the "${name}" header`);
  }
  return `${name}: ${value}`;
}

function parseHead(head: string): { status: number; statusText: string; headers: Headers } {
  const [statusLine = '', ...lines] = head.split('\r\n');
  const match = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/.exec(statusLine);
  if (!match) throw new InvalidResponseError('The server did not answer with HTTP');

  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    try {
      headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    } catch {
      // a header the runtime will not hold is not worth failing the response for
    }
  }
  return { status: Number(match[1]), statusText: match[2] ?? '', headers };
}

// a chunked body, put back together
async function readChunked(wire: Wire, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const line = decoder.decode(await wire.readUntil(LINE_END, MAX_CHUNK_LINE_BYTES));
    // a chunk size may be followed by extensions after a semicolon
    const sizeText = line.split(';')[0]?.trim() ?? '';
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) {
      throw new InvalidResponseError('The response body is not valid chunked encoding');
    }
    const size = parseInt(sizeText, 16);
    if (size === 0) break;

    total += size;
    if (total > maxBytes) {
      throw new InvalidResponseError(`Response is larger than ${maxBytes} bytes`);
    }
    chunks.push(await wire.read(size));
    await wire.read(2); // the line end after the chunk's data
  }
  // trailers, if any, are not needed; the connection is closed after this
  return concatBytes(chunks);
}

// undo a content encoding, refusing to produce more than `maxBytes`
async function decompress(
  body: Uint8Array,
  format: 'gzip' | 'deflate',
  maxBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const stream = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        throw new InvalidResponseError(`Response is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof InvalidResponseError || signal?.aborted) throw error;
    throw new InvalidResponseError('The response body could not be decompressed', {
      cause: error,
    });
  }
  return concatBytes(chunks);
}

export function createProxyFetch(options: ProxyFetchOptions): ProxyFetch {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new TypeError(`Unsupported URL scheme "${url.protocol}"`);
    }
    const secure = url.protocol === 'https:';
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const port = url.port ? Number(url.port) : secure ? 443 : 80;

    let connection = await options.open({ host, port }, init.signal);
    const limit = deadline(options.timeout, `Timed out waiting for ${url.host}`, init.signal);
    try {
      if (secure) connection = await abortable(connection.startTls(host), limit.signal);
      const wire = new Wire(connection, limit.signal);

      const headers = { 'Accept-Encoding': 'gzip', ...init.headers };
      const request = [
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        headerLine('Host', url.host),
        ...Object.entries(headers)
          // these two are this function's to set
          .filter(([name]) => !/^(host|connection)$/i.test(name))
          .map(([name, value]) => headerLine(name, value)),
        'Connection: close',
      ];
      await wire.write(request.join('\r\n') + '\r\n\r\n');

      let parsed: ReturnType<typeof parseHead>;
      try {
        // a server may send informational responses (100 Continue, 103 Early Hints) before
        // the real one. Each is a header block of its own; read on until the final response
        for (let informational = 0; ; informational++) {
          const head = decoder.decode(await wire.readUntil(HEADER_END, MAX_HEADER_BYTES));
          // drop the blank line that ended the header
          parsed = parseHead(head.slice(0, -4));
          if (parsed.status >= 200 || parsed.status === 101) break;
          if (informational >= MAX_INFORMATIONAL_RESPONSES) {
            throw new InvalidResponseError(
              `${url.host} sent more than ${MAX_INFORMATIONAL_RESPONSES} informational responses`
            );
          }
        }
      } catch (error) {
        if (error instanceof ConnectionError) {
          throw new ConnectionError(`${url.host} closed the connection without answering`, {
            cause: error,
          });
        }
        throw error;
      }
      const { status, statusText, headers: responseHeaders } = parsed;

      const max = options.maxResponseBytes;
      let body: Uint8Array | null = null;
      if (!NO_BODY.has(status) && status >= 200) {
        const transferEncoding = responseHeaders.get('transfer-encoding')?.toLowerCase() ?? '';
        const contentLength = responseHeaders.get('content-length');
        if (transferEncoding.includes('chunked')) {
          body = await readChunked(wire, max);
        } else if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
          const length = Number(contentLength);
          if (length > max) {
            throw new InvalidResponseError(`Response is larger than ${max} bytes`);
          }
          body = await wire.read(length);
        } else {
          body = await wire.readToEnd(max);
        }

        const encoding = responseHeaders.get('content-encoding')?.toLowerCase().trim() ?? '';
        if (body.length && (encoding === 'gzip' || encoding === 'x-gzip')) {
          body = await decompress(body, 'gzip', max, limit.signal);
        } else if (body.length && encoding === 'deflate') {
          body = await decompress(body, 'deflate', max, limit.signal);
        } else if (encoding && encoding !== 'identity' && body.length) {
          throw new InvalidResponseError(`Unsupported content encoding "${encoding}"`);
        }
      }

      const response = new Response(body && body.length ? (body as BodyInit) : null, {
        // Response only takes 200 to 599; anything else is not a usable answer
        status: status >= 200 && status <= 599 ? status : 502,
        statusText,
        headers: responseHeaders,
      });
      // a constructed Response has no url of its own
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    } finally {
      limit.clear();
      await connection.close().catch(() => {});
    }
  };
}
