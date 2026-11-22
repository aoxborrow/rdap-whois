// the redaction detector, on the placeholder text found in the fixture corpus and on the real
// data that looks like it, and lookup()'s use of it
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRedacted, withoutRedacted } from '../../src/record/redaction';
import { transformWhoisDomainData } from '../../src/record/transforms';
import type { DomainContact, DomainData } from '../../src/record/types';
import { parseWhois } from '../../src/whois/client';

describe('isRedacted', () => {
  it('knows the placeholders servers write, from the fixture corpus', () => {
    for (const value of [
      'REDACTED FOR PRIVACY',
      'REDACTED_FOR_PRIVACY',
      'REDACTED',
      'Redacted | Registry Policy',
      'Redacted | EU Data Subject',
      '(Redacted for privacy)',
      'Redacted for Privacy (Redactado por Privacidad)',
      'GDPR Redacted',
      'DATA REDACTED',
      'REDACTED.FORPRIVACY',
      '[REDACTED].3054348621',
      'redacted@nominet.uk',
      'undisclosed-email@knipp.de',
      '***@***.***',
      'privacy-redacted@example.com',
      'Redacted for privacy <redacted@example.com>',
      'Redacted for privacy [redacted@example.com]',
      'REDACTED FOR PRIVACY mailto:redacted@nominet.uk',
      'Please query the RDDS service of the Registrar of Record identified in this output for information on how to contact the Registrant, Admin, or Tech contacts of the queried domain name.',
      'Please query the Whois service of the Registrar of Record identified in this output for information on how to contact the Registrant',
      'Please contact the Registrar listed above',
      'Kindly refer to the RDDS server associated with the identified registrar in this output to obtain contact details',
      'Personal data, can not be publicly disclosed according to applicable laws.',
      'Not Available From Registry',
      'Not Disclosed',
      'NOT DISCLOSED!',
      '<not disclosed>',
      '<data not disclosed>',
      'Not Disclosed Not Disclosed',
      'Data Protected',
      'Data protected, not disclosed',
      '[HIDDEN PERSONAL DATA]',
      'hidden',
      'HIDDEN!',
      '(not shown)',
      'not published',
      'Statutory Masking Enabled',
      'GDPR Masked',
      'Personal Information',
      'Restricted',
      'N/A',
      'None',
      '******',
      'xxxx',
      '  REDACTED  ',
      'REDACTEDFORPRIVACY',
      'DataRedacted',
      'redactedforprivacy@registrar.example',
      'undisclosed-email@knipp.de',
      '***@***.***',
      'xxxx@xxxx.xxx',
      'privacy-redacted@registrar.example',
      // known privacy services in place of the holder
      'Domains By Proxy, LLC',
      'DomainsByProxy, LLC',
      'DomainsByProxy.com',
      'DomainsByProxy.com, 100 S. Mill Ave, Suite 1600',
      'Registration Private',
      'Privacy service provided by Withheld for Privacy ehf',
      'Privacy service provided by WITHHELD FOR PRIVACY LLC',
      'Super Privacy Service LTD c/o Dynadot',
      'Domain Protection Services, Inc.',
      'Contact Privacy Inc. Customer 0143223645',
      'Privacy Protect, LLC (PrivacyProtect.org)',
      'Whois Privacy Protection Foundation',
      'Privacy Administrator',
      'See PrivacyGuardian.org',
      'c/o whoisproxy.com',
    ]) {
      expect(isRedacted(value), value).toBe(true);
    }
  });

  it('keeps real data that looks like a placeholder', () => {
    for (const value of [
      // a privacy service's forwarding address, which reaches the holder
      '765c4298f1dc45c4b2e6c7fbcf35531a.protect@withheldforprivacy.com',
      'pw-70682ff09e444b4468bf462095e62c97@privacyguardian.org',
      'axon.ai@domainsbyproxy.com',
      'anonymous-registrant@brandsight.com',
      'active.domains@redacted-for-privacy.name',
      'redaction@example.org',
      'my-redaction-domain.com@domainsbyproxy.com',
      'Redaction Studio Ltd',
      'Unredacted',
      'UNREDACTED',
      'private@smithfamily.net',
      'confidential@lawfirm.com',
      'redactie@krant.nl',
      // a URL is kept even inside placeholder text
      'https://www.instra.com/en/about-us/contact-us',
      'REDACTED FOR PRIVACY - Send message to contact by visiting https://www.ovhcloud.com/en/lp/request-ovhcloud-registered-domain-contact/',
      'Select Contact Domain Holder Link https://privacy.sav.com/?domain=alta.inc',
      'Not Disclosed - Visit www.internet.ee for webbased WHOIS',
      // and so is a real email address inside placeholder text
      'REDACTED FOR PRIVACY - contact owner@example.com',
      'REDACTED FOR PRIVACY <redacted@example.com>, contact owner@example.com',
      // names and places with the words in them
      'Zomato Media Private Limited',
      'SINGAPORE NETWORK INFORMATION CENTRE (SGNIC) PRIVATE LIMITED',
      'Private Mail Bag',
      'PROXYTLD SARL',
      'Zoho Corporation Private Limited',
      'Domains By Proxy Holdings Group',
      'Privacy Protection Services of Ohio',
      'Private Person',
      'Protection of Private Person',
      'PRIVATE REGISTRY AUTHORITY',
      'Restricted Area Holdings Ltd',
      'Hidden Valley Road',
      'NA',
      'Google LLC',
      '',
    ]) {
      expect(isRedacted(value), value).toBe(false);
    }
    expect(isRedacted(null)).toBe(false);
    expect(isRedacted(undefined)).toBe(false);
  });
});

const contact = (fields: Partial<DomainContact>): DomainContact => ({
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
  ...fields,
});

const record = (fields: Partial<DomainData>): DomainData => ({
  domainName: 'example.com',
  domainNameUnicode: null,
  creationDate: null,
  expirationDate: null,
  updatedDate: null,
  nameservers: [],
  dnssec: null,
  eppStatus: [],
  unmappedStatus: [],
  available: false,
  reserved: false,
  registrar: null,
  registrant: null,
  admin: null,
  tech: null,
  billing: null,
  ...fields,
});

describe('withoutRedacted', () => {
  it('nulls redacted values and keeps the rest', () => {
    const { registrant } = withoutRedacted(
      record({
        registrant: contact({
          name: 'REDACTED FOR PRIVACY',
          org: 'Example Org',
          address: ['REDACTED FOR PRIVACY', '1 Main St'],
          countryCode: 'US',
          email:
            'Please query the RDDS service of the Registrar of Record identified in this output',
          url: 'https://example-registrar.com/contact',
        }),
      })
    );
    expect(registrant).toEqual(
      contact({
        org: 'Example Org',
        address: ['1 Main St'],
        countryCode: 'US',
        url: 'https://example-registrar.com/contact',
      })
    );
  });

  it('makes a contact that was all placeholders null, as if it had not been sent', () => {
    const redacted = contact({
      id: 'REDACTED',
      name: 'REDACTED FOR PRIVACY',
      address: ['REDACTED FOR PRIVACY'],
      phone: 'REDACTED FOR PRIVACY',
    });
    expect(withoutRedacted(record({ admin: redacted, tech: contact({ id: 'C1' }) }))).toMatchObject(
      {
        admin: null,
        // a contact sent with only a handle had nothing redacted, so it stays
        tech: contact({ id: 'C1' }),
      }
    );
  });

  it('keeps a registrar that has only its IANA ID left', () => {
    const registrar = {
      ianaId: 146,
      name: 'REDACTED',
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
      abuseEmail: null,
      abusePhone: null,
    };
    expect(withoutRedacted(record({ registrar })).registrar).toEqual({ ...registrar, name: null });
  });

  it('leaves the rest of the record alone', () => {
    const given = record({ nameservers: ['ns1.example.com'], eppStatus: ['ok'] });
    expect(withoutRedacted(given)).toEqual(given);
  });
});

// every WHOIS answer in the fixture corpus, made into a record
function corpus(): { file: string; record: DomainData }[] {
  const root = new URL('../../fixtures/whois/', import.meta.url);
  const out: { file: string; record: DomainData }[] = [];
  for (const dir of ['found', 'found/fixme', 'reserved', 'merged', 'unclassified']) {
    const at = new URL(`${dir}/`, root);
    for (const file of readdirSync(at).filter(name => name.endsWith('.txt'))) {
      const [server, name] = file.slice(0, -4).split('___');
      if (!name) continue;
      const parsed = parseWhois(readFileSync(new URL(file, at), 'utf8'), server);
      if (parsed.status !== 'found' || !parsed.data) continue;
      try {
        out.push({
          file: `${dir}/${file}`,
          record: transformWhoisDomainData({ query: name, queryType: 'domain', data: parsed.data }),
        });
      } catch {
        // not a domain record
      }
    }
  }
  return out;
}

const PARTIES = ['registrar', 'registrant', 'admin', 'tech', 'billing'] as const;

describe('the fixture corpus', () => {
  const records = corpus();
  // every value the detector nulls, by field
  const nulled = new Map<string, Set<string>>();
  for (const { record } of records) {
    for (const party of PARTIES) {
      for (const [field, value] of Object.entries(record[party] ?? {})) {
        for (const text of Array.isArray(value) ? value : [value]) {
          if (typeof text === 'string' && isRedacted(text)) {
            const set = nulled.get(field) ?? new Set();
            nulled.set(field, set.add(text.trim()));
          }
        }
      }
    }
  }

  it('is a corpus worth testing on', () => {
    expect(records.length).toBeGreaterThan(3000);
    expect(nulled.get('name')?.size).toBeGreaterThan(10);
  });

  it('keeps every URL, every forwarding address and every lookalike name', () => {
    for (const [field, values] of nulled) {
      for (const value of values) {
        expect(value, field).not.toMatch(/https?:\/\/|www\./i);
        expect(value, field).not.toMatch(/private\s+limited|proxytld|mail\s+bag|sgnic/i);
        if (field === 'email') expect(value.split('@')[0], field).toMatch(/redact|undisclosed/i);
      }
    }
  });

  it('nulls the privacy services the corpus has', () => {
    const names = new Set([...(nulled.get('name') ?? []), ...(nulled.get('org') ?? [])]);
    for (const service of [
      'Domains By Proxy, LLC',
      'Privacy service provided by Withheld for Privacy ehf',
      'Super Privacy Service LTD c/o Dynadot',
      'See PrivacyGuardian.org',
    ]) {
      expect(names, service).toContain(service);
    }
  });

  it('leaves no placeholder in a record it cleaned', () => {
    for (const { file, record } of records) {
      const clean = withoutRedacted(record);
      for (const party of PARTIES) {
        for (const value of Object.values(clean[party] ?? {})) {
          for (const text of Array.isArray(value) ? value : [value]) {
            if (typeof text === 'string') expect(isRedacted(text), file).toBe(false);
          }
        }
      }
    }
  });
});
