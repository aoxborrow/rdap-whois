import { UTCDate } from '@date-fns/utc';
import { parse } from 'date-fns/parse';
import { ParserOptions } from './data-types';

const KNOWN_DATE_FORMATS_FNS = [
  'dd-MMM-yyyy', // 02-jan-2000
  'dd-MMMM-yyyy', // 11-February-2000
  'dd-MM-yyyy', // 20-10-2000
  'dd-MM-yyyy HH:mm:ss', // 07-01-1998 00:00:00
  'yyyy-MM-dd', // 2000-01-02
  'dd.MM.yyyy', // 2.1.2000
  'yyyy.MM.dd', // 2000.01.02
  'yyyy/MM/dd', // 2000/01/02
  'yyyy/MM/dd HH:mm:ss', // 2011/06/01 01:05:01
  'yyyyMMdd', // 20170209
  'yyyyMMdd HH:mm:ss', // 20110908 14:44:51
  'dd/MM/yyyy', // 02/01/2013
  'yyyy. MM. dd.', // 2000. 01. 02.
  'yyyy.MM.dd HH:mm:ss', // 2014.03.08 10:28:24
  'dd-MMM-yyyy HH:mm:ss', // 24-Jul-2009 13:20:03
  'EEE MMM dd HH:mm:ss yyyy', // Tue Jun 21 23:59:59 2011
  'EEE MMM dd yyyy', // Tue Dec 12 2000
  "yyyy-MM-dd'T'HH:mm:ss", // 2007-01-26T19:10:31
  "yyyy-MM-dd'T'HH:mm:ss'Z'", // 2007-01-26T19:10:31Z
  'yyyy-MM-dd HH:mm:ss.SSS', // 2018-05-19 12:18:44.329
  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", // 2018-12-01T16:17:30.568Z
  "yyyy-MM-dd'T'HH:mm:ss.SSSS'Z'", // 2018-12-01T16:17:30.5684Z
  "yyyy-MM-dd'T'HH:mm:ss.SSSSS'Z'", // 2018-12-01T16:17:30.56845Z
  "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'", // 2018-12-01T16:17:30.568456Z
  "yyyy-MM-dd'T'HH:mm:ss.SSSSSSS'Z'", // 2018-12-01T16:17:30.5684567Z
  "yyyy-MM-dd'T'HH:mm:ss.SSS", // 2011-09-08T14:44:51.622265+03:00
  'yyyy-MM-dd HH:mm:ss', // 2018-11-02 11:29:08
  "yyyy-MM-dd'T'HH:mm:ssxxx", // 2013-12-06T08:17:22-0800
  "yyyy-MM-dd't'HH:mm:ss.SSS", // 2011-09-08t14:44:51.622265
  "yyyy-MM-dd't'HH:mm:ss", // 2007-01-26t19:10:31
  "yyyy-MM-dd't'HH:mm:ss'Z'", // 2007-01-26t19:10:31Z
  "yyyy-MM-dd't'HH:mm:ss.SSS'z'", // 2007-01-26t19:10:31.00z
  "yyyy-MM-dd HH:mm:ss'Z'", // 2000-08-22 18:55:20Z
  'yyyy-MM-dd HH:mm:ss', // 2000-08-22 18:55:20
  'dd MMM yyyy HH:mm:ss', // 08 Apr 2013 05:44:00
  'dd/MM/yyyy HH:mm:ss', // 23/04/2015 12:00:07
  'dd/MM/yyyy HH:mm:ss.SSS', // 23/04/2015 12:00:07.619546
  'MMMM dd yyyy', // August 14 2017
  'MMMM d yyyy', // December 7 1995 (ISNIC single-digit day)
  'EEE MMM d HH:mm:ss yyyy', // Sun Nov 5 14:03:48 2000 (ZA NiC single-digit day)
  'EEEE d MMM yyyy', // Tuesday 16 Jun 2026 (ja.net, ordinal already stripped)
  'EEEE d MMMM yyyy', // Saturday 16 March 2024 (ja.net)
  'dd.MM.yyyy HH:mm:ss', // 08.03.2014 10:28:24
  'yyyy', // 2001
  'MMM-yyyy', // aug-1996
  'yyyy-MMM-dd.', // 2024-Apr-02.
  'dd MMM yyyy', // 08 Oct 2004
  'dd MMMM yyyy', // 02 August 2000
  'dd MMMM yyyy HH:mm:ss.SSS', // 01 April 2018 04:14:07.826
  'dd MMMM yyyy HH:mm:ss', // 01 April 2018 04:14:07
  'yyyy-MM-dd HH:mm:ss.SSS', // 2018-05-19 12:18:44.329522
  "yyyy-MM-dd'T'HH:mm:ss.SSS", // 2011-09-08T14:44:51.622265
  "yyyy-MM-dd't'HH:mm:ss.SSS", // 2011-09-08t14:44:51.622265
  'dd/MM/yyyy HH:mm:ss.SSS', // 23/04/2015 12:00:07.619546
  'yyyy-MM-dd HH:mm:ss.SSSS', // 2018-05-19 12:18:44.329522
  "yyyy-MM-dd'T'HH:mm:ss.SSSS", // 2011-09-08T14:44:51.622265
  "yyyy-MM-dd't'HH:mm:ss.SSSS", // 2011-09-08t14:44:51.622265
  'dd/MM/yyyy HH:mm:ss.SSSS', // 23/04/2015 12:00:07.619546
  'yyyy-MM-dd HH:mm:ss.SSSSS', // 2018-05-19 12:18:44.329522
  "yyyy-MM-dd'T'HH:mm:ss.SSSSS", // 2011-09-08T14:44:51.622265
  "yyyy-MM-dd't'HH:mm:ss.SSSSS", // 2011-09-08t14:44:51.622265
  'dd/MM/yyyy HH:mm:ss.SSSSS', // 23/04/2015 12:00:07.619546
  'yyyy-MM-dd HH:mm:ss.SSSSSS', // 2018-05-19 12:18:44.329522
  "yyyy-MM-dd'T'HH:mm:ss.SSSSSS", // 2011-09-08T14:44:51.622265
  "yyyy-MM-dd't'HH:mm:ss.SSSSSS", // 2011-09-08t14:44:51.622265
  'dd/MM/yyyy HH:mm:ss.SSSSSS', // 23/04/2015 12:00:07.619546
  'dd MMMM yyyy', // 02 August 2000
];

const DAYFIRST_DATE_FORMATS_FNS = [
  'dd-MMM-yyyy', // 02-jan-2000
  'dd-MMMM-yyyy', // 11-February-2000
  'dd-MM-yyyy', // 20-10-2000
  'dd-MM-yyyy HH:mm:ss', // 07-01-1998 00:00:00
  'dd.MM.yyyy', // 2.1.2000
  'dd/MM/yyyy', // 02/01/2013
  'dd MMM yyyy HH:mm:ss', // 08 Apr 2013 05:44:00
  'dd/MM/yyyy HH:mm:ss', // 23/04/2015 12:00:07
  'dd/MM/yyyy HH:mm:ss.SSS', // 23/04/2015 12:00:07.619546
  'dd.MM.yyyy HH:mm:ss', // 08.03.2014 10:28:24
];

// clean date strings, remove timezones
export function cleanDateString(value: string): string {
  return (
    value
      // Remove 'before' keyword anywhere in the string
      .replace(/\bbefore\b\s*/gi, '')
      // Remove ordinal indicators (st, nd, rd, th) from day numbers
      .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
      // Remove 'at' in date strings
      .replace(/\s+at\s+/gi, ' ')
      // Remove timezone names and other non-numeric timezone indicators
      .replace(/\s*\([^)]*\)/g, '') // Remove anything in parentheses
      .replace(/\[UTC\]/g, '') // Remove [UTC]
      .replace(/\s*(UTC|GMT|EEST|CLT|CLST|[A-Z]{3,4})/g, '') // Remove timezone names
      // Remove timezone offsets that follow a time component in various formats:
      // +03, +03:00, -08:00, +0200, -0800, etc.
      .replace(/(?<=T?\d{2}(?::\d{2}){1,2}(?:\.\d+)?)[+-]\d{1,2}(?::?\d{2})?(?=Z?\s*$)/g, '')
      // collapse runs of internal whitespace — ctime-style dates pad single-digit days
      // with a double space (`Sun Nov  5 14:03:48 GMT 2000`, `December  7 1995`)
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

// a `(UTC+8)`-style suffix (TWNIC) states the wall clock's zone; capture it so the parsed
// wall time can be shifted to the true UTC instant. Bare zone names (GMT, JST, …) stay
// stripped-and-ignored as before — only this explicit numeric form is honored
const UTC_OFFSET_SUFFIX = /\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)/i;

// an ISO 8601 date and time with its zone, which says the instant exactly
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i;

/** parse date strings using date-fns and lots of formats */
export function parseDate(value: string, options?: ParserOptions): Date | null {
  if (!value) return null;
  const text = value.trim().toUpperCase();
  if (ISO_WITH_ZONE.test(text)) {
    // Date.parse rolls an impossible day over (February 30 is March 2), so the day is
    // checked against the month first
    const [year, month, day] = text.slice(0, 10).split('-').map(Number);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    ) {
      return null;
    }
    const iso = text.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const time = Date.parse(iso);
    if (!isNaN(time)) return new Date(time);
  }
  const offset = value.match(UTC_OFFSET_SUFFIX);
  const cleaned = cleanDateString(value);

  // if dayFirst is specified, try those formats first
  const formats = options?.dayFirst
    ? [...DAYFIRST_DATE_FORMATS_FNS, ...KNOWN_DATE_FORMATS_FNS]
    : KNOWN_DATE_FORMATS_FNS;

  // try each format until one works
  for (const format of formats) {
    try {
      const parsed = parse(cleaned, format, new UTCDate());
      if (!isNaN(parsed.getTime())) {
        if (offset) {
          // the parsed value is the wall clock in the stated zone; shift to the UTC instant
          const minutes =
            Number(offset[1]) * 60 + Math.sign(Number(offset[1])) * Number(offset[2] ?? 0);
          return new Date(parsed.getTime() - minutes * 60_000);
        }
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// convert to ISO with no milliseconds or timezone offset
// this is our format for whois fixtures, purposely not super accurate
export function toDateString(date: Date): string {
  // format to YYYY-MM-DDThh:mm:ssZ with guaranteed 4-digit year
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// regex to match exactly "YYYY-MM-DDThh:mm:ssZ" format, no millisconds or timezone offset
export function isDateString(input: string): boolean {
  // first check if the string format matches our pattern
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!pattern.test(input)) {
    return false;
  }

  // try to parse the string into a date
  const date = new Date(input);
  return !isNaN(date.getTime());
}
