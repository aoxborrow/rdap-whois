// The header a fixture file carries above the server's response: the query, the server that
// answered and when, one `###%%% ` line each, then a blank line. The parser never sees it:
// whatever reads a fixture for parsing reads it through readFixture, which drops it.
import { readFileSync } from 'node:fs';
import { UTCDate } from '@date-fns/utc';
import { toDateString } from '../../../src/whois/dates';

// a raw response with the header added above it
export function addRawMetadata(
  query: string,
  server: string,
  timestamp: string,
  raw: string
): string {
  // the corpus's date form: UTC, whole seconds
  const dateString = toDateString(new UTCDate(timestamp));
  return (
    '###%%% QRY: ' +
    query +
    '\n' +
    '###%%% SRV: ' +
    server +
    '\n' +
    '###%%% TME: ' +
    dateString +
    '\n' +
    '\n' +
    raw.trim()
  );
}

// the response without its header lines
export function stripRawMetadata(raw: string): string {
  return raw.replace(/^###%%% [^\n]*\n/gm, '');
}

// the header's fields, each null when the header does not give it
export function parseRawMetadata(raw: string): {
  query: string | null;
  server: string | null;
  timestamp: string | null;
} {
  const result: { query: string | null; server: string | null; timestamp: string | null } = {
    query: null,
    server: null,
    timestamp: null,
  };
  for (const line of raw.split('\n', 3)) {
    const match = line.match(/^###%%% (QRY|SRV|TME): (.+)$/);
    if (!match) continue;
    const [, type, value] = match;
    if (type === 'QRY') result.query = value.trim();
    else if (type === 'SRV') result.server = value.trim();
    else result.timestamp = value.trim();
  }
  return result;
}

// a fixture file's response, as the server sent it: the header is dropped
export function readFixture(path: string): string {
  return stripRawMetadata(readFileSync(path, 'utf8'));
}
