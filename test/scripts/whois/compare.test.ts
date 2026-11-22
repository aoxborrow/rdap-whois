// Unit tests for the A/B gate's value-shape SUSPECT detector (docs/archive/whois-parser-refactor.md
// §6ag/§6ag2). suspectReasons is the guard that stops the new engine INTRODUCING a
// structurally-wrong value that the golden scoreboard can't see (the class that let
// registrantName="Pisa" pass as a "lift"). It is deliberately narrow: only a non-date in a
// date field, because that is the one shape that is near-certainly a mis-map and not a legit
// registry quirk. Email-shape and phone-shape checks were dropped — an abuse WEB-FORM URL in an
// email field and a `[PRIVEE]`/`REDACTED` placeholder in a phone field are legit, so flagging
// them made the gate cry wolf. These tests pin both the one rule that stays and the retired ones.
import { describe, it, expect } from 'vitest';
import { suspectReasons } from '../../../scripts/whois/compare';

describe('suspectReasons — value-shape suspects', () => {
  it('flags a non-date in a date field but accepts a real ISO date', () => {
    expect(suspectReasons('creationDate', 'Pisa')).toEqual(['unparseable-date']);
    expect(suspectReasons('expirationDate', '2027-02-28T00:00:00Z')).toEqual([]);
    expect(suspectReasons('updatedDate', 'not a date at all')).toEqual(['unparseable-date']);
  });

  it('accepts a parsed Date value and flags an invalid one', () => {
    expect(suspectReasons('creationDate', new Date('2010-01-01T00:00:00Z'))).toEqual([]);
    expect(suspectReasons('creationDate', new Date(Number.NaN))).toEqual(['unparseable-date']);
  });

  it('does not flag a bracketed redaction placeholder in a date field', () => {
    expect(suspectReasons('creationDate', '[REDACTED]')).toEqual([]);
  });

  it('does NOT flag a web-form URL in an email field (a feature, not a mis-map)', () => {
    // PANDI/.id registrarAbuseEmail is an abuse WEB-FORM URL, handled downstream — the gate
    // must not flag it. Email-shape checking was retired for exactly this class.
    expect(suspectReasons('registrarAbuseEmail', 'https://pandi.id/domain-abuse-form/')).toEqual(
      []
    );
    expect(suspectReasons('registrantEmail', 'see website')).toEqual([]);
  });

  it('does NOT flag a redaction placeholder in a phone/fax field', () => {
    // `[PRIVEE]` (AFNIC) / `REDACTED FOR PRIVACY` are legit privacy placeholders, not mis-maps.
    expect(suspectReasons('registrantPhone', 'REDACTED')).toEqual([]);
    expect(suspectReasons('techFax', '[PRIVEE]')).toEqual([]);
  });

  it('does not flag plausible values, empties, or arrays (name-shape is the fold differential, not here)', () => {
    expect(suspectReasons('registrantName', 'Dublin')).toEqual([]); // shape-plausible; caught by the fold differential
    expect(suspectReasons('registrantOrg', 'Google Ireland Holdings')).toEqual([]);
    expect(suspectReasons('registrantEmail', '')).toEqual([]);
    expect(suspectReasons('registrantEmail', null)).toEqual([]);
    expect(suspectReasons('nameservers', ['ns1.example.com', 'ns2.example.com'])).toEqual([]);
  });
});
