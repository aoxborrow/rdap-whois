import { describe, expect, it } from 'vitest';
import { normalizeValue } from '../../../scripts/whois/oracles/schema';

describe('normalizeValue', () => {
  it('reads a year-1 placeholder date as no date', () => {
    expect(normalizeValue('updated_date', '0001-01-01T00:00:00Z')).toBeNull();
    expect(normalizeValue('updated_date', '0001-01-01T00:00:00.00Z')).toBeNull();
    expect(normalizeValue('updated_date', '2022-08-24T17:16:23.73Z')).toBe('2022-08-24T17:16:23Z');
  });
});
