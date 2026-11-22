// The address a server says a request came from is the one thing replaced in a recorded
// fixture. These tests use invented responses; every name, number and address in them is
// made up or from a range set aside for examples.
import { describe, expect, it } from 'vitest';
import { recordedFixture } from '../../../scripts/whois/lib/fixture';
import { replaceRequestAddresses } from '../../../scripts/whois/lib/request-address';

const SERVER = 'whois.example-registrar.test';

const icann = [
  'Domain Name: EXAMPLE.TEST',
  'Registry Domain ID: 12345_DOMAIN_TEST-VRSN',
  'Registrar WHOIS Server: whois.example-registrar.test',
  'Registrar URL: http://www.example-registrar.test',
  'Updated Date: 2024-01-02T03:04:05Z',
  'Creation Date: 2001-02-03T04:05:06Z',
  'Registrar: Example Registrar, Inc.',
  'Registrar IANA ID: 9999',
  'Registrar Abuse Contact Email: abuse@example-registrar.test',
  'Registrar Abuse Contact Phone: +1.5550100',
  'Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited',
  'Registry Registrant ID: C123456-TEST',
  'Registrant Name: Jordan Quillfeather',
  'Registrant Organization: Quillfeather Holdings',
  'Registrant Street: 12 Imaginary Lane',
  'Registrant City: Springfield',
  'Registrant State/Province: IL',
  'Registrant Postal Code: 62704',
  'Registrant Country: US',
  'Registrant Phone: +1.2175550142',
  'Registrant Email: jordan.q@quillfeather.test',
  'Admin Name: Jordan Quillfeather',
  'Admin Email: jordan.q@quillfeather.test',
  'Tech Name: Example Registrar, Inc.',
  'Tech Email: abuse@example-registrar.test',
  'Name Server: NS1.EXAMPLE-DNS.TEST',
  'Name Server: NS2.EXAMPLE-DNS.TEST',
  'DNSSEC: unsigned',
  '',
].join('\n');

describe('the address a server says the request came from', () => {
  // every address here is from a range set aside for examples, or made up
  const echoes = [
    ['% Request from 198.18.7.9', '% Request from 192.0.2.1'],
    ['% request from 198.18.7.9', '% request from 192.0.2.1'],
    ['Source IP:               198.18.7.9', 'Source IP:               192.0.2.1'],
    [
      '# Hello 198.18.7.9. Your session has been logged.',
      '# Hello 192.0.2.1. Your session has been logged.',
    ],
    ['% 2025-03-20T15:31:39-03:00 - 198.18.7.9', '% 2025-03-20T15:31:39-03:00 - 192.0.2.1'],
    ['%% [198.18.7.9 REQUEST] >> -V Md5.5 nic.fr', '%% [192.0.2.1 REQUEST] >> -V Md5.5 nic.fr'],
    ['request limit exceeded for 198.18.7.9', 'request limit exceeded for 192.0.2.1'],
    [
      '    The WHOIS query quota for 198.18.7.9 has been exceeded',
      '    The WHOIS query quota for 192.0.2.1 has been exceeded',
    ],
    ['% Request from fd12:3456:789a::42', '% Request from 2001:db8::1'],
    ['% Request from ::ffff:198.18.7.42', '% Request from 2001:db8::1'],
    [
      '# Hello fd12:3456:789a::7. Your session has been logged.',
      '# Hello 2001:db8::1. Your session has been logged.',
    ],
  ];

  it.each(echoes)('replaces it in %j', (line, expected) => {
    const { text, replaced } = replaceRequestAddresses(`first line\n${line}\nlast line\n`);
    expect(text).toBe(`first line\n${expected}\nlast line\n`);
    expect(replaced).toBe(1);
  });

  it('leaves a nameserver address and a documentation address alone', () => {
    const text = [
      'nserver: ns1.example.test 198.18.7.9',
      'Name Server: ns2.example.test',
      'IP Address: 198.18.7.10',
      '% Request from 192.0.2.1',
      'request limit exceeded for 127.0.0.1',
      '',
    ].join('\n');
    expect(replaceRequestAddresses(text)).toEqual({ text, replaced: 0 });
  });

  it('gives the same text when run again', () => {
    const once = replaceRequestAddresses(
      '# Hello 198.18.7.9. Your session has been logged.\n'
    ).text;
    expect(replaceRequestAddresses(once)).toEqual({ text: once, replaced: 0 });
  });
});

describe('recordedFixture', () => {
  it('keeps the response as sent, except the request address, and builds the golden from it', () => {
    const raw = `% Request from 198.18.7.9\n${icann}`;
    const { text, data } = recordedFixture(raw, SERVER);
    expect(text).toBe(`% Request from 192.0.2.1\n${icann}`);
    expect(data.registrantName).toBe('Jordan Quillfeather');
    expect(data.registrantEmail).toBe('jordan.q@quillfeather.test');
  });
});
