// How the combined record's helpers read statuses, DNSSEC values, contacts and a
// registrar's IANA ID out of what a WHOIS or RDAP server said.
import { describe, expect, it } from 'vitest';
import type { RdapDomainResponse, RdapEntityObject } from '../../src/rdap/types';
import { transformRdapDomainData } from '../../src/record/transforms';
import type { DomainContact } from '../../src/record/types';
import { transformWhoisDomainData } from '../../src/record/transforms';
import {
  contactHasData,
  parseRdapDnssecValue,
  parseRdapStatus,
  splitRdapPhone,
  unmappedRdapStatus,
  unmappedWhoisStatus,
  parseWhoisStatus,
} from '../../src/record/utils';
import type { WhoisDataType } from '../../src/whois/data-types';
import { parseWhoisDnssecValue } from '../../src/whois/utils';

describe('parseWhoisStatus', () => {
  it('should keep valid EPP status codes', () => {
    const result = parseWhoisStatus(['clientTransferProhibited', 'serverDeleteProhibited']);
    expect(result).toEqual(['clientTransferProhibited', 'serverDeleteProhibited']);
  });

  // normalization now happens upstream in statusFormatter, so this is a pure narrowing:
  // anything that isn't already a canonical EPP code is dropped rather than mapped
  it('should drop anything that is not already a canonical EPP code', () => {
    expect(parseWhoisStatus(['clientTransferProhibited', 'customStatus', 'ok'])).toEqual([
      'clientTransferProhibited',
      'ok',
    ]);
    expect(parseWhoisStatus(['CLIENTTRANSFERPROHIBITED', 'Ok'])).toBeNull();
  });

  it('should handle empty or null input', () => {
    expect(parseWhoisStatus(null)).toBeNull();
    expect(parseWhoisStatus([])).toBeNull();
    expect(parseWhoisStatus('')).toBeNull();
  });

  it('should handle string input', () => {
    expect(parseWhoisStatus('clientTransferProhibited')).toEqual(['clientTransferProhibited']);
  });
});

describe('parseRdapStatus', () => {
  it('should parse RDAP status codes', () => {
    const result = parseRdapStatus(['client transfer prohibited', 'server delete prohibited']);
    expect(result).toEqual(['clientTransferProhibited', 'serverDeleteProhibited']);
  });

  it('should drop status codes with no EPP equivalent', () => {
    const result = parseRdapStatus(['client transfer prohibited', 'custom rdap status', 'active']);
    expect(result).toEqual(['clientTransferProhibited', 'ok']);
  });

  // RFC 8056: the unqualified RDAP prohibited statuses do not map onto the EPP ones,
  // because they lose the registrar-set (client) vs registry-set (server) distinction
  it('should drop the unqualified prohibited statuses rather than guessing client*', () => {
    expect(
      parseRdapStatus([
        'delete prohibited',
        'renew prohibited',
        'transfer prohibited',
        'update prohibited',
      ])
    ).toBeNull();
  });

  it('should handle empty input', () => {
    expect(parseRdapStatus(null)).toBeNull();
    expect(parseRdapStatus([])).toBeNull();
  });
});

describe('parseWhoisDnssecValue', () => {
  it('should handle boolean values', () => {
    expect(parseWhoisDnssecValue(true)).toBe(true);
    expect(parseWhoisDnssecValue(false)).toBe(false);
  });

  it('should parse positive DNSSEC values', () => {
    expect(parseWhoisDnssecValue('yes')).toBe(true);
    expect(parseWhoisDnssecValue('SIGNED')).toBe(true);
    expect(parseWhoisDnssecValue('Active')).toBe(true);
    expect(parseWhoisDnssecValue('enabled')).toBe(true);
    expect(parseWhoisDnssecValue('1')).toBe(true);
    expect(parseWhoisDnssecValue('true')).toBe(true);
    expect(parseWhoisDnssecValue('signedDelegation')).toBe(true);
    expect(parseWhoisDnssecValue('Signed Delegation')).toBe(true);
  });

  it('should parse negative DNSSEC values', () => {
    expect(parseWhoisDnssecValue('no')).toBe(false);
    expect(parseWhoisDnssecValue('UNSIGNED')).toBe(false);
    expect(parseWhoisDnssecValue('Inactive')).toBe(false);
    expect(parseWhoisDnssecValue('disabled')).toBe(false);
    expect(parseWhoisDnssecValue('0')).toBe(false);
    expect(parseWhoisDnssecValue('false')).toBe(false);
    expect(parseWhoisDnssecValue('unsignedDelegation')).toBe(false);
    expect(parseWhoisDnssecValue('Unsigned  delegation')).toBe(false);
  });

  // unmappable text no longer has a home on DomainData — it reads as unknown, and the
  // whois tool's own result still carries what the registry actually said
  it('should treat unknown values as unknown', () => {
    expect(parseWhoisDnssecValue('unknown')).toBeNull();
    expect(parseWhoisDnssecValue('custom status')).toBeNull();
  });

  it('should handle null/undefined values', () => {
    expect(parseWhoisDnssecValue(null)).toBeNull();
    expect(parseWhoisDnssecValue(undefined)).toBeNull();
  });
});

describe('contactHasData', () => {
  it('should return false for null contact', () => {
    expect(contactHasData(null)).toBe(false);
  });

  it('should return true for contact with meaningful data', () => {
    const contact: DomainContact = {
      id: 'C123',
      name: 'John Doe',
      org: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      phone: null,
      phoneExt: null,
      fax: null,
      faxExt: null,
      email: null,
      url: null,
    };
    expect(contactHasData(contact)).toBe(true);
  });

  it('should return true for contact with only email', () => {
    const contact: DomainContact = {
      id: null,
      name: null,
      org: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      phone: null,
      phoneExt: null,
      fax: null,
      faxExt: null,
      email: 'john@example.com',
      url: null,
    };
    expect(contactHasData(contact)).toBe(true);
  });

  it('should return true for contact with address array', () => {
    const contact: DomainContact = {
      id: null,
      name: null,
      org: null,
      address: ['123 Main St'],
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      phone: null,
      phoneExt: null,
      fax: null,
      faxExt: null,
      email: null,
      url: null,
    };
    expect(contactHasData(contact)).toBe(true);
  });

  it('should return false for contact with all null/empty fields', () => {
    const contact: DomainContact = {
      id: null,
      name: null,
      org: null,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      phone: null,
      phoneExt: null,
      fax: null,
      faxExt: null,
      email: null,
      url: null,
    };
    expect(contactHasData(contact)).toBe(false);
  });

  it('should return false for contact with empty arrays', () => {
    const contact: DomainContact = {
      id: null,
      name: '',
      org: null,
      address: [],
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      phone: null,
      phoneExt: null,
      fax: null,
      faxExt: null,
      email: null,
      url: null,
    };
    expect(contactHasData(contact)).toBe(false);
  });
});

describe('splitRdapPhone', () => {
  it('takes the extension of a tel URI apart', () => {
    expect(splitRdapPhone('+1.4806242505;ext=567')).toEqual({ phone: '+1.4806242505', ext: '567' });
  });

  it('leaves a number with no extension as it is', () => {
    expect(splitRdapPhone('+1.4806242505')).toEqual({ phone: '+1.4806242505', ext: null });
    expect(splitRdapPhone(null)).toEqual({ phone: null, ext: null });
  });
});

describe('parseRdapStatus wording', () => {
  it('maps the EPP code written in any case or separator', () => {
    expect(
      parseRdapStatus(['clientTransferProhibited', 'SERVER_HOLD', 'Client-Hold', 'OK'])
    ).toEqual(['clientTransferProhibited', 'serverHold', 'clientHold', 'ok']);
  });

  it('keeps an unqualified lock out of the EPP codes and in the unmapped list', () => {
    const status = ['transfer prohibited', 'client transfer prohibited'];
    expect(parseRdapStatus(status)).toEqual(['clientTransferProhibited']);
    expect(unmappedRdapStatus(status)).toEqual(['transfer prohibited']);
  });
});

describe('RDAP Entity IANA ID Parsing', () => {
  const createMockRdapResult = (registrarEntity: RdapEntityObject) => ({
    query: 'example.com',
    queryType: 'domain',
    server: 'rdap.example.com',
    data: {
      objectClassName: 'domain',
      ldhName: 'example.com',
      entities: [registrarEntity],
    } as RdapDomainResponse,
    timestamp: '2021-01-01',
  });

  it('does not take the IANA ID from a numeric handle, which is the registry’s own', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: '292',
      roles: ['registrar'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBeNull();
  });

  it('should handle non-numeric handle and fallback to publicIds', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: 'REG-HANDLE-ABC',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'IANA Registrar ID',
          identifier: '123',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBe(123);
  });

  it('should handle redacted handle and fallback to publicIds', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: 'REDACTED FOR PRIVACY',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'IANA Registrar ID',
          identifier: '456',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBe(456);
  });

  it('takes the public ID over a handle with a leading number', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: '123-ABC-456',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'IANA Registrar ID',
          identifier: '789',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBe(789);
  });

  it('should handle text-only handle and fallback to publicIds', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: 'ABC-123-DEF',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'IANA Registrar ID',
          identifier: '999',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBe(999); // fallback to publicIds
  });

  it('should return null IANA ID when both handle and publicIds fail', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: 'NON-NUMERIC-HANDLE',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'Other ID Type',
          identifier: '999',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBeNull();
  });

  it('should handle empty handle and use publicIds', () => {
    const registrarEntity: RdapEntityObject = {
      objectClassName: 'entity',
      handle: '',
      roles: ['registrar'],
      publicIds: [
        {
          type: 'IANA Registrar ID',
          identifier: '555',
        },
      ],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Test Registrar'],
        ],
      ],
    };

    const result = transformRdapDomainData(createMockRdapResult(registrarEntity));
    expect(result.registrar?.ianaId).toBe(555);
  });
});

describe('ianaId from publicIds', () => {
  const registrar = (identifier: string): RdapEntityObject => ({
    objectClassName: 'entity',
    handle: '802247',
    roles: ['registrar'],
    publicIds: [{ type: 'IANA Registrar ID', identifier }],
    vcardArray: [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'MarkMonitor Inc.'],
      ],
    ],
  });
  const ianaId = (identifier: string) =>
    transformRdapDomainData({
      query: 'google.com.au',
      queryType: 'domain',
      data: {
        objectClassName: 'domain',
        ldhName: 'google.com.au',
        entities: [registrar(identifier)],
      } as RdapDomainResponse,
    }).registrar?.ianaId;

  it('takes the public ID, never the registry handle beside it', () => {
    // auDA's handle for MarkMonitor is 802247; its IANA ID is 292
    expect(ianaId('292')).toBe(292);
  });

  it('is null for zero, which SIDN sends for none', () => {
    expect(ianaId('0000')).toBeNull();
  });

  it('is null for an identifier that is not all digits', () => {
    expect(ianaId('1234-ABC')).toBeNull();
  });
});

describe('parseRdapDnssecValue', () => {
  it('reads delegationSigned, not zoneSigned', () => {
    // Google Registry sends this for every unsigned .dev name
    expect(parseRdapDnssecValue({ zoneSigned: true, delegationSigned: false })).toBe(false);
    expect(parseRdapDnssecValue({ zoneSigned: false, delegationSigned: true })).toBe(true);
  });

  it('falls back to DS or key data, and is null with neither', () => {
    const ds = { keyTag: 1, algorithm: 8, digestType: 2, digest: 'AB' };
    expect(parseRdapDnssecValue({ zoneSigned: true, dsData: [ds] } as never)).toBe(true);
    expect(parseRdapDnssecValue({ zoneSigned: true })).toBeNull();
  });
});

describe('the transforms', () => {
  it('clean RDAP nameservers as WHOIS ones, without the trailing dot', () => {
    const record = transformRdapDomainData({
      query: 'google.co.uk',
      queryType: 'domain',
      data: {
        objectClassName: 'domain',
        ldhName: 'google.co.uk',
        nameservers: [
          { objectClassName: 'nameserver', ldhName: 'NS1.Google.com.' },
          { objectClassName: 'nameserver', ldhName: 'ns2.google.com' },
        ],
      } as RdapDomainResponse,
    });
    expect(record.nameservers).toEqual(['ns1.google.com', 'ns2.google.com']);
  });

  it('give no registrar when the response said nothing about one, over RDAP', () => {
    const record = transformRdapDomainData({
      query: 'example.com',
      queryType: 'domain',
      data: {
        objectClassName: 'domain',
        ldhName: 'example.com',
        entities: [
          {
            objectClassName: 'entity',
            roles: ['registrar'],
            vcardArray: ['vcard', [['version', {}, 'text', '4.0']]],
          },
        ],
      } as RdapDomainResponse,
    });
    expect(record.registrar).toBeNull();
  });

  it('give no registrar when the response said nothing about one, over WHOIS', () => {
    // DENIC gives no registrar at all
    const record = transformWhoisDomainData({
      query: 'google.de',
      queryType: 'domain',
      data: {
        domainName: 'google.de',
        nameservers: ['ns1.google.com'],
        registrarAddress: [],
      } as unknown as WhoisDataType,
    });
    expect(record.registrar).toBeNull();
  });
});

describe('unmappedWhoisStatus', () => {
  it('splits statuses written on one line with commas, as .ru does', () => {
    expect(unmappedWhoisStatus(['REGISTERED, DELEGATED, VERIFIED'])).toEqual([
      'REGISTERED',
      'DELEGATED',
      'VERIFIED',
    ]);
  });
});
