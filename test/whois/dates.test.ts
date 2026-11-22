import { describe, expect, it } from 'vitest';
import { parseDate } from '../../src/whois/dates';

interface DateFixture {
  input: string;
  parsed: string | null;
}

// Helper to strip milliseconds from ISO date string
function stripMilliseconds(isoString: string | null): string | null {
  if (!isoString) return null;
  // Replace the milliseconds part (if any) with just Z
  return isoString.replace(/\.\d+Z$/, 'Z');
}

const DATE_FIXTURES: DateFixture[] = [
  {
    input: '0001-01-01T00:00:00.00Z',
    parsed: '0001-01-01T00:00:00Z',
  },
  {
    input: '02-jan-2000',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '11-February-2000',
    parsed: '2000-02-11T00:00:00Z',
  },
  {
    input: '20-10-2000',
    parsed: '2000-10-20T00:00:00Z',
  },
  {
    input: '2000-01-02',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '2.1.2000',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '2000.01.02',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '2000/01/02',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '2011/06/01 01:05:01',
    parsed: '2011-06-01T01:05:01Z',
  },
  {
    input: '2011/06/01 01:05:01 (+0900)',
    parsed: '2011-06-01T01:05:01Z',
  },
  {
    input: '20170209',
    parsed: '2017-02-09T00:00:00Z',
  },
  {
    input: '20110908 14:44:51',
    parsed: '2011-09-08T14:44:51Z',
  },
  {
    input: '02/01/2013',
    parsed: '2013-01-02T00:00:00Z',
  },
  {
    input: '2000. 01. 02.',
    parsed: '2000-01-02T00:00:00Z',
  },
  {
    input: '2014.03.08 10:28:24',
    parsed: '2014-03-08T10:28:24Z',
  },
  {
    input: '24-Jul-2009 13:20:03 UTC',
    parsed: '2009-07-24T13:20:03Z',
  },
  {
    input: 'Tue Jun 21 23:59:59 GMT 2011',
    parsed: '2011-06-21T23:59:59Z',
  },
  {
    input: 'Tue Dec 12 2000',
    parsed: '2000-12-12T00:00:00Z',
  },
  {
    input: '2007-01-26T19:10:31Z',
    parsed: '2007-01-26T19:10:31Z',
  },
  {
    input: '2007-01-26T19:10:31Z[UTC]',
    parsed: '2007-01-26T19:10:31Z',
  },
  {
    input: '2018-05-19 12:18:44.329522',
    parsed: '2018-05-19T12:18:44Z',
  },
  {
    input: '2018-12-01T16:17:30.568Z',
    parsed: '2018-12-01T16:17:30Z',
  },
  {
    input: '2011-09-08T14:44:51.622265+03:00',
    parsed: '2011-09-08T11:44:51Z',
  },
  {
    input: '2018-11-02 11:29:08+02:00',
    parsed: '2018-11-02T09:29:08Z',
  },
  {
    input: '2013-12-06T08:17:22-0800',
    parsed: '2013-12-06T16:17:22Z',
  },
  {
    // an impossible day is no date, not the day it would roll over to
    input: '2025-02-30T00:00:00Z',
    parsed: null,
  },
  {
    input: '2024-02-29T00:00:00+01:00',
    parsed: '2024-02-28T23:00:00Z',
  },
  {
    // an explicit offset is honoured, not stripped
    input: '2020-01-01T10:00:00+09:00',
    parsed: '2020-01-01T01:00:00Z',
  },
  {
    input: '1970-01-01T02:00:00+02:00Z',
    parsed: '1970-01-01T02:00:00Z',
  },
  {
    input: '2011-09-08t14:44:51.622265',
    parsed: '2011-09-08T14:44:51Z',
  },
  {
    input: '2007-01-26T19:10:31',
    parsed: '2007-01-26T19:10:31Z',
  },
  {
    input: '2007-01-26T19:10:31Z',
    parsed: '2007-01-26T19:10:31Z',
  },
  {
    input: '2007-01-26t19:10:31.00z',
    parsed: '2007-01-26T19:10:31Z',
  },
  {
    input: '2011-03-30T19:36:27+0200',
    parsed: '2011-03-30T17:36:27Z',
  },
  {
    input: '2000-08-22 18:55:20Z',
    parsed: '2000-08-22T18:55:20Z',
  },
  {
    input: '2000-08-22 18:55:20',
    parsed: '2000-08-22T18:55:20Z',
  },
  {
    input: '08 Apr 2013 05:44:00',
    parsed: '2013-04-08T05:44:00Z',
  },
  {
    input: '23/04/2015 12:00:07 EEST',
    parsed: '2015-04-23T12:00:07Z',
  },
  {
    input: '23/04/2015 12:00:07 EEST',
    parsed: '2015-04-23T12:00:07Z',
  },
  {
    input: '23/04/2015 12:00:07.619546 EEST',
    parsed: '2015-04-23T12:00:07Z',
  },
  {
    input: 'August 14 2017',
    parsed: '2017-08-14T00:00:00Z',
  },
  {
    input: '08.03.2014 10:28:24',
    parsed: '2014-03-08T10:28:24Z',
  },
  {
    input: 'before 2001',
    parsed: '2001-01-01T00:00:00Z',
  },
  {
    input: 'before aug-1996',
    parsed: '1996-08-01T00:00:00Z',
  },
  {
    input: 'before 1996-01-01',
    parsed: '1996-01-01T00:00:00Z',
  },
  {
    input: 'before 19960821',
    parsed: '1996-08-21T00:00:00Z',
  },
  {
    input: '2017-09-26 11:38:29 (GMT+00:00)',
    parsed: '2017-09-26T11:38:29Z',
  },
  {
    input: '2024-Apr-02.',
    parsed: '2024-04-02T00:00:00Z',
  },
];

describe('dates: parseDate', () => {
  DATE_FIXTURES.forEach(({ input, parsed }) => {
    it(`should parse "${input}" correctly`, () => {
      const result = parseDate(input);
      const resultStr = result ? result.toISOString() : null;
      expect(stripMilliseconds(resultStr)).toBe(parsed);
    });
  });
});
