import { ConnectionError, InvalidResponseError, RdapWhoisError } from '../errors';
import { abortable, abortReason } from './deadline';
import type { Connection } from './types';

const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// the position of `needle` in `haystack`, or -1
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Buffered reads and writes over a Connection: exactly n bytes, up to a delimiter, or to the
// end, each bounded by an optional AbortSignal. The handshakes, the WHOIS exchange and the
// tunnelled fetch are all written against this.
export class Wire {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer: Uint8Array = EMPTY;
  private ended = false;
  private released = false;

  constructor(
    connection: Connection,
    private readonly signal?: AbortSignal
  ) {
    this.reader = connection.readable.getReader();
    this.writer = connection.writable.getWriter();
  }

  // a failure of the stream itself is a connection failure, whatever the transport threw
  private async guard<T>(work: Promise<T>, doing: string): Promise<T> {
    try {
      return await abortable(work, this.signal);
    } catch (error) {
      if (error instanceof RdapWhoisError) throw error;
      if (this.signal?.aborted) throw abortReason(this.signal);
      const detail = error instanceof Error ? error.message : String(error);
      throw new ConnectionError(`Connection failed while ${doing}: ${detail}`, { cause: error });
    }
  }

  async write(data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    await this.guard(this.writer.write(bytes), 'sending');
  }

  // pull one more chunk into the buffer. False at the end of the stream
  private async fill(): Promise<boolean> {
    if (this.ended) return false;
    const { value, done } = await this.guard(this.reader.read(), 'reading');
    if (done) {
      this.ended = true;
      return false;
    }
    if (value.length) {
      this.buffer = this.buffer.length ? concatBytes([this.buffer, value]) : value;
    }
    return true;
  }

  private take(length: number): Uint8Array {
    const out = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return out;
  }

  // exactly `length` bytes. Fails when the stream ends first
  async read(length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) {
      if (!(await this.fill())) {
        throw new ConnectionError(
          `Connection closed after ${this.buffer.length} of ${length} expected bytes`
        );
      }
    }
    return this.take(length);
  }

  // everything up to and including `delimiter`. Fails when the stream ends first, or when
  // more than `maxBytes` arrive without it
  async readUntil(delimiter: Uint8Array, maxBytes: number): Promise<Uint8Array> {
    for (;;) {
      const index = indexOfBytes(this.buffer, delimiter);
      if (index !== -1) return this.take(index + delimiter.length);
      if (this.buffer.length > maxBytes) {
        throw new InvalidResponseError(`No end of header within ${maxBytes} bytes`);
      }
      if (!(await this.fill())) {
        throw new ConnectionError('Connection closed before the end of the header');
      }
    }
  }

  // everything until the stream ends. Stops reading and fails once more than `maxBytes`
  // have arrived
  async readToEnd(maxBytes: number): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const add = (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > maxBytes) {
        throw new InvalidResponseError(`Response is larger than ${maxBytes} bytes`);
      }
      if (chunk.length) chunks.push(chunk);
    };

    add(this.take(this.buffer.length));
    while (!this.ended) {
      const { value, done } = await this.guard(this.reader.read(), 'reading');
      if (done) this.ended = true;
      else add(value);
    }
    return concatBytes(chunks);
  }

  // give the streams back. Returns any bytes that were read but not consumed
  release(): Uint8Array {
    if (!this.released) {
      this.released = true;
      // a runtime may refuse to release a reader with a read still pending, which is the
      // state an aborted handshake leaves it in. The connection is closed next either way
      try {
        this.reader.releaseLock();
      } catch {
        // nothing to do
      }
      try {
        this.writer.releaseLock();
      } catch {
        // nothing to do
      }
    }
    const rest = this.buffer;
    this.buffer = EMPTY;
    return rest;
  }
}
