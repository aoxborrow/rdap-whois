import { describe, expect, it } from 'vitest';
import { validateRdapDomain } from '../../src/rdap/validate';

const NOW = new Date('2026-11-09T12:00:00Z');
const events = (...pairs: [string, string][]) =>
  pairs.map(([eventAction, eventDate]) => ({ eventAction, eventDate }));

describe('validateRdapDomain', () => {
  it('accepts a response that names the domain and has sane dates', () => {
    const result = validateRdapDomain(
      {
        ldhName: 'EXAMPLE.COM',
        events: events(
          ['registration', '1995-08-14T04:00:00Z'],
          ['expiration', '2027-08-13T04:00:00Z']
        ),
      },
      'example.com',
      NOW
    );
    expect(result.name).toBe('match');
    expect(result.responseName).toBe('example.com');
    expect(result.creationDate?.toISOString()).toBe('1995-08-14T04:00:00.000Z');
  });

  it('compares names in ASCII, ignoring case and a trailing dot', () => {
    const idn = validateRdapDomain({ unicodeName: 'münchen.de' }, 'xn--mnchen-3ya.de', NOW);
    expect(idn.name).toBe('match');
    expect(validateRdapDomain({ ldhName: 'example.com.' }, 'Example.COM', NOW).name).toBe('match');
  });

  it('matches an upper-case Unicode name against its xn-- form', () => {
    expect(validateRdapDomain({ ldhName: 'xn--e1afmkfd.xn--p1ai' }, 'Пример.рф', NOW).name).toBe(
      'match'
    );
    expect(validateRdapDomain({ unicodeName: 'MÜNCHEN.de' }, 'xn--mnchen-3ya.de', NOW).name).toBe(
      'match'
    );
  });

  it('reports a response about a different name', () => {
    const result = validateRdapDomain({ ldhName: 'other.com' }, 'example.com', NOW);
    expect(result.name).toBe('mismatch');
    expect(result.responseName).toBe('other.com');
  });

  it('reports a response that names nothing', () => {
    const result = validateRdapDomain({ events: [] }, 'example.com', NOW);
    expect(result.name).toBe('missing');
    expect(result.responseName).toBeNull();
  });

  it('leaves the creation date null when there is no registration event', () => {
    const result = validateRdapDomain(
      { ldhName: 'example.com', events: events(['last changed', '2026-01-01T00:00:00Z']) },
      'example.com',
      NOW
    );
    expect(result.creationDate).toBeNull();
  });

  it('drops an unparseable registration date', () => {
    const result = validateRdapDomain(
      { ldhName: 'example.com', events: events(['registration', 'not a date']) },
      'example.com',
      NOW
    );
    expect(result.creationDate).toBeNull();
  });

  it('allows a date up to a day ahead, and drops one further in the future', () => {
    const near = validateRdapDomain(
      { ldhName: 'example.com', events: events(['registration', '2026-11-10T06:00:00Z']) },
      'example.com',
      NOW
    );
    expect(near.creationDate).not.toBeNull();

    const far = validateRdapDomain(
      { ldhName: 'example.com', events: events(['registration', '2027-03-01T00:00:00Z']) },
      'example.com',
      NOW
    );
    expect(far.creationDate).toBeNull();
  });

  it('drops a registration date after the expiration date', () => {
    const result = validateRdapDomain(
      {
        ldhName: 'example.com',
        events: events(
          ['registration', '2024-06-01T00:00:00Z'],
          ['expiration', '2023-06-01T00:00:00Z']
        ),
      },
      'example.com',
      NOW
    );
    expect(result.creationDate).toBeNull();
  });

  it('keeps the earliest of more than one registration date', () => {
    const result = validateRdapDomain(
      {
        ldhName: 'example.com',
        events: events(
          ['registration', '2020-05-05T00:00:00Z'],
          ['registration', '2010-01-01T00:00:00Z']
        ),
      },
      'example.com',
      NOW
    );
    expect(result.creationDate?.toISOString()).toBe('2010-01-01T00:00:00.000Z');
  });

  it('treats one registration instant in two spellings as one date', () => {
    const result = validateRdapDomain(
      {
        ldhName: 'example.com',
        events: events(
          ['registration', '2010-01-01T00:00:00Z'],
          ['registration', '2010-01-01T00:00:00.000Z'],
          ['registration', '2010-01-01T00:00:00+00:00']
        ),
      },
      'example.com',
      NOW
    );
    expect(result.creationDate).toEqual(new Date('2010-01-01T00:00:00Z'));
  });

  it('reads a date-time without an offset as UTC', () => {
    const result = validateRdapDomain(
      {
        ldhName: 'example.com',
        events: events(
          ['registration', '2010-01-01T00:00:00'],
          ['registration', '2010-01-01T00:00:00Z']
        ),
      },
      'example.com',
      NOW
    );
    expect(result.creationDate).toEqual(new Date('2010-01-01T00:00:00Z'));
  });

  it('reads a date and time split by a space or a lower-case t as UTC, in any time zone', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      for (const date of ['2010-01-01 00:00:00', '2010-01-01t00:00:00']) {
        const result = validateRdapDomain(
          { ldhName: 'example.com', events: events(['registration', date]) },
          'example.com',
          NOW
        );
        expect(result.creationDate).toEqual(new Date('2010-01-01T00:00:00Z'));
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('survives events that are not objects', () => {
    const result = validateRdapDomain(
      { ldhName: 'example.com', events: [null, 'x', { eventAction: 'registration' }] },
      'example.com',
      NOW
    );
    expect(result.creationDate).toBeNull();
  });
});
