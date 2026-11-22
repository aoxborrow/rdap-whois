// the country tables are generated from i18n-iso-countries, which the library used directly
// before. Every country value in the fixture corpus, and every name and code in the tables,
// must read the same as it did then.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_CODES,
  getCountryName,
  isValidCountryCode,
  parseCountryCode,
} from '../../src/record/countries';
import { ALPHA3_TO_ALPHA2, COUNTRY_NAMES } from '../../src/record/generated/countries';
import * as reference from '../support/countries-reference';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

// every value the corpus gives a country: a WHOIS line whose key says country, and a parsed
// field whose name does
function corpusValues(): string[] {
  const values = new Set<string>();
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && /country/i.test(key)) values.add(value);
    else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  for (const entry of readdirSync(fixtures, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (entry.name.endsWith('.txt')) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /^[^:]*country[^:]*:\s*(.+)$/i.exec(line);
        if (match) values.add(match[1]);
      }
    } else if (entry.name.endsWith('.json')) {
      try {
        visit(JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        // not every .json in the corpus is one document
      }
    }
  }
  return [...values];
}

describe('country tables', () => {
  it('parse every country value in the fixture corpus as i18n-iso-countries did', () => {
    const values = corpusValues();
    expect(values.length).toBeGreaterThan(100);
    const differ = values.filter(
      value => parseCountryCode(value) !== reference.parseCountryCode(value)
    );
    expect(differ).toEqual([]);
  });

  it('parse every name, alias and code in the tables as i18n-iso-countries did', () => {
    const inputs = [
      ...Object.values(COUNTRY_NAMES).flat(),
      ...Object.values(COUNTRY_NAMES)
        .flat()
        .map(name => name.toUpperCase()),
      ...Object.keys(ALPHA3_TO_ALPHA2),
      ...COUNTRY_CODES.map(code => code.toLowerCase()),
      'usa',
      'Great Britain',
      'deutschland',
      'Côte d’Ivoire',
      // i18n-iso-countries matched names by case only, not accents: 'Curacao' and 'Réunion'
      // stay unmatched, and 'Aland Islands' matches only as the table's own alias
      'Curacao',
      'Réunion',
      'Aland Islands',
      'REDACTED FOR PRIVACY',
      '12',
      'XX',
      '',
    ];
    const differ = inputs.filter(
      value => parseCountryCode(value) !== reference.parseCountryCode(value)
    );
    expect(differ).toEqual([]);
  });

  it('name every code as i18n-iso-countries did', () => {
    for (const code of COUNTRY_CODES) {
      expect(getCountryName(code), code).toBe(reference.getCountryName(code));
      expect(isValidCountryCode(code)).toBe(true);
    }
    expect(isValidCountryCode('XX')).toBe(false);
  });
});
