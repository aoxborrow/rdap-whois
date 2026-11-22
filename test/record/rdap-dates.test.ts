import { describe, expect, it } from 'vitest';
import { rdapRecordHop } from '../../src/record/record';
import { transformRdapDomainData } from '../../src/record/transforms';

describe('transformRdapDomainData dates', () => {
  it('reads an event date with no offset as UTC, in any time zone', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const record = transformRdapDomainData({
        query: 'example.com',
        queryType: 'domain',
        data: {
          objectClassName: 'domain',
          ldhName: 'example.com',
          events: [
            { eventAction: 'registration', eventDate: '2020-01-01T00:00:00' },
            { eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' },
          ],
        } as never,
      });
      expect(record.creationDate).toEqual(new Date('2020-01-01T00:00:00Z'));
      expect(record.expirationDate).toEqual(new Date('2030-01-01T00:00:00Z'));
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('rdapRecordHop dates', () => {
  it('reads a registrar expiration with no offset as UTC, in any time zone', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const hop = rdapRecordHop(
        'example.com',
        'registrar',
        {
          rdapConformance: ['rdap_level_0'],
          objectClassName: 'domain',
          ldhName: 'example.com',
          events: [{ eventAction: 'registrar expiration', eventDate: '2030-01-01T00:00:00' }],
        } as never,
        false
      );
      expect(hop?.registrarExpiration).toEqual(new Date('2030-01-01T00:00:00Z'));
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});
