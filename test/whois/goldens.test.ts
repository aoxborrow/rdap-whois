// The parser against the fixture corpus: every recorded response that has a golden must
// still parse to it. This is the library's regression gate for the WHOIS engine.
// `whois:check-parsers` runs the same comparison and writes a report; this just fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOMAIN_QUERY_TYPE } from '../../src/common/constants';
import { assertedFields, fieldMatches, withRequiredFields } from '../../scripts/whois/compare';
import { readFixture } from '../../scripts/whois/lib/raw';
import { parseBlocks } from '../../src/whois/mapping';

const FOUND = fileURLToPath(new URL('../../fixtures/whois/found/', import.meta.url));

// fixtures are `<server>___<query>.txt`, with a golden `<server>___<query>.json` beside most
const fixtures = readdirSync(FOUND)
  .filter(file => file.endsWith('.txt') && file.includes('___'))
  .map(file => file.slice(0, -'.txt'.length))
  .filter(base => existsSync(`${FOUND}${base}.json`))
  .sort();

describe('whois goldens', () => {
  it('has a corpus to check', () => {
    expect(fixtures.length).toBeGreaterThan(1000);
  });

  it('parses every fixture to its golden', () => {
    const failures: string[] = [];
    for (const base of fixtures) {
      const server = base.slice(0, base.indexOf('___'));
      const golden = withRequiredFields(
        JSON.parse(readFileSync(`${FOUND}${base}.json`, 'utf8')) as Record<string, unknown>
      );
      const raw = readFixture(`${FOUND}${base}.txt`);
      const parsed = parseBlocks(raw, server, DOMAIN_QUERY_TYPE).data as unknown as Record<
        string,
        unknown
      >;
      for (const field of assertedFields(golden)) {
        if (!fieldMatches(field, golden[field], parsed[field])) {
          failures.push(
            `${base} ${field}: expected ${JSON.stringify(golden[field])}, got ${JSON.stringify(parsed[field])}`
          );
        }
      }
    }
    // listing the first few is more useful than a count when this fails
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
