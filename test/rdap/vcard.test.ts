import { describe, expect, test } from 'vitest';
import { parseToVcardSimple } from '../../src/rdap/vcard';

describe('parseToVcardSimple', () => {
  test('should parse basic vCard with required fields', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result).toEqual({
      version: '4.0',
      name: 'John Doe',
    });
  });

  test('should parse fax number from tel entries with fax type', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['work', 'voice'] }, 'uri', 'tel:+1-555-555-1234'],
        ['tel', { type: ['work', 'fax'] }, 'uri', 'tel:+1-555-555-9999'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.phone).toBe('+1-555-555-1234');
    expect(result?.fax).toBe('+1-555-555-9999');
  });

  test('should prefer fax with lower preference value', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['work', 'fax'], pref: '2' }, 'uri', 'tel:+1-555-555-8888'],
        ['tel', { type: ['home', 'fax'], pref: '1' }, 'uri', 'tel:+1-555-555-9999'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.fax).toBe('+1-555-555-9999'); // Lower pref value wins
  });

  test('should handle fax with string type parameter', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: 'fax' }, 'uri', 'tel:+1-555-555-7777'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.fax).toBe('+1-555-555-7777');
  });

  test('should return first fax when no preference is set', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['work', 'fax'] }, 'uri', 'tel:+1-555-555-1111'],
        ['tel', { type: ['home', 'fax'] }, 'uri', 'tel:+1-555-555-2222'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.fax).toBe('+1-555-555-1111'); // First one without preference
  });

  test('should not set fax when no fax tel entries exist', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['work', 'voice'] }, 'uri', 'tel:+1-555-555-1234'],
        ['tel', { type: ['home', 'voice'] }, 'uri', 'tel:+1-555-555-5678'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.phone).toBe('+1-555-555-1234');
    expect(result?.fax).toBeUndefined();
  });

  test('should strip tel: prefix from fax number', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['fax'] }, 'uri', 'tel:+1-555-555-FAXN'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.fax).toBe('+1-555-555-FAXN');
  });

  test('should handle case-insensitive fax type matching', () => {
    const rawVcard = [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'John Doe'],
        ['tel', { type: ['FAX'] }, 'uri', 'tel:+1-555-555-CAPS'],
        ['tel', { type: ['Fax'] }, 'uri', 'tel:+1-555-555-MIXD'],
      ],
    ];

    const result = parseToVcardSimple(rawVcard);
    expect(result?.fax).toBe('+1-555-555-CAPS'); // First matching fax
  });

  test('should throw error for invalid vCard structure', () => {
    const invalidVcard = ['not-vcard', []];
    expect(() => parseToVcardSimple(invalidVcard)).toThrow('Invalid vCard structure');
  });

  test('should throw error for missing version', () => {
    const rawVcard = ['vcard', [['fn', {}, 'text', 'John Doe']]];
    expect(() => parseToVcardSimple(rawVcard)).toThrow(
      "RDAP vCard missing or invalid 'version' property"
    );
  });

  test('should return null when only version field is present', () => {
    const rawVcard = ['vcard', [['version', {}, 'text', '4.0']]];
    const result = parseToVcardSimple(rawVcard);
    expect(result).toBeNull();
  });
});
