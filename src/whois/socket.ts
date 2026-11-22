import { deadline } from '../net/deadline';
import type { Connection } from '../net/types';
import { Wire } from '../net/wire';

export interface WhoisExchangeOptions {
  // how long the exchange may take once the connection is open, in milliseconds
  timeout: number;
  // the largest response to accept, in bytes
  maxResponseBytes: number;
  // the character encoding of the response. Default utf-8
  encoding?: string;
  signal?: AbortSignal;
}

// The WHOIS protocol (RFC 3912) on an open connection: send one line, read until the server
// closes. Returns the response text exactly as it was sent; an empty string means the server
// closed without sending anything. The connection is closed when this returns or throws.
export async function whoisExchange(
  connection: Connection,
  queryString: string,
  options: WhoisExchangeOptions
): Promise<string> {
  const limit = deadline(
    options.timeout,
    'Timed out waiting for the WHOIS response',
    options.signal
  );
  const wire = new Wire(connection, limit.signal);
  try {
    await wire.write(queryString + '\r\n');
    const bytes = await wire.readToEnd(options.maxResponseBytes);
    // a wrong encoding name is the caller's mistake, and TextDecoder says so with a RangeError
    return new TextDecoder(options.encoding ?? 'utf-8').decode(bytes);
  } finally {
    limit.clear();
    wire.release();
    await connection.close().catch(() => {});
  }
}
