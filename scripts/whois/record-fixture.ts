#!/usr/bin/env tsx
// Re-record a whois fixture pair (raw .txt + golden .json) from a live query.
// Writes to fixtures/whois/found/ in the corpus conventions: the .txt is
// the raw response including ###%%% QRY/SRV/TME metadata headers, the .json is the
// flattened golden ({ query, server, ...parsed fields }). The response is written as the
// server sent it, except the address it says the request came from (lib/request-address.ts).
// The query goes through the library client (each server's own query string, the proxy,
// the parser).
// Run: `npm run whois:record-fixture <server> <query>`
import { writeFileSync } from 'node:fs';
import { addRawMetadata } from './lib/raw';
import { toolingClient } from '../lib/client';
import { WHOIS_FIXTURES_DIR } from '../lib/paths';
import { recordedFixture } from './lib/fixture';

const FOUND_DIR = `${WHOIS_FIXTURES_DIR}found/`;

async function recordFixture(server: string, query: string): Promise<void> {
  const [hop] = await toolingClient().whois(query, { server, followReferrals: 0, timeout: 10000 });
  if (!hop?.raw) {
    throw new Error(`No raw response from ${server} for ${query} — nothing written`);
  }
  // a found-corpus fixture must be a live registration, so refuse anything else
  if (hop.status !== 'found') {
    throw new Error(`${server} answered ${hop.status} for ${query} — nothing written`);
  }

  // the golden is built from the text that goes on disk
  const raw = addRawMetadata(query, server, new Date().toISOString(), hop.raw);
  const { text, data } = recordedFixture(raw, server);
  const base = `${FOUND_DIR}${server}___${query}`;
  writeFileSync(`${base}.txt`, text, 'utf8');
  writeFileSync(`${base}.json`, JSON.stringify({ query, server, ...data }, null, 2) + '\n', 'utf8');

  const fieldCount = Object.values(hop.data ?? {}).filter(value => value !== null).length;
  console.log(`recorded ${server}___${query} (${fieldCount} non-null fields)`);
}

const [server, query] = process.argv.slice(2);
if (!server || !query) {
  console.error('Usage: npm run whois:record-fixture <server> <query>');
  process.exit(1);
}

recordFixture(server, query).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
