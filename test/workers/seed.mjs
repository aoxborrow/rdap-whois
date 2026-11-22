// seeds the local Workers KV of the example Worker (examples/worker) with one cached RDAP
// answer, so the Workers job in .github/workflows/ci.yml can serve a lookup in workerd with
// no network: the Worker reads the hops from KV, revives their dates and builds the record.
// The answer is made here on Node, by the built library through a stubbed fetch, and its
// expiry (2030) is not the real one, so a record carrying it came from the cache.
//
//   node test/workers/seed.mjs <key file> <value file>
//
// writes the KV key and the JSON value for `wrangler kv key put --local`
import { writeFileSync } from 'node:fs';
import { RdapWhois } from '../../dist/index.js';

const RDAP_RESPONSE = {
  objectClassName: 'domain',
  rdapConformance: ['rdap_level_0'],
  handle: '2336799_DOMAIN_COM-VRSN',
  ldhName: 'EXAMPLE.COM',
  status: ['client delete prohibited', 'client transfer prohibited'],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2030-08-13T04:00:00Z' },
  ],
  nameservers: [
    { objectClassName: 'nameserver', ldhName: 'A.IANA-SERVERS.NET' },
    { objectClassName: 'nameserver', ldhName: 'B.IANA-SERVERS.NET' },
  ],
  entities: [
    {
      objectClassName: 'entity',
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: '376' }],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'RESERVED-IANA'],
        ],
      ],
    },
  ],
};

const [keyFile, valueFile] = process.argv.slice(2);
if (!keyFile || !valueFile)
  throw new Error('usage: node test/workers/seed.mjs <key file> <value file>');

let stored;
const client = new RdapWhois({
  retries: 0,
  fetch: async () =>
    new Response(JSON.stringify(RDAP_RESPONSE), {
      status: 200,
      headers: { 'content-type': 'application/rdap+json' },
    }),
  cache: {
    get: () => null,
    set: (key, hops) => {
      stored = { key, hops };
    },
  },
});
await client.lookup('example.com', { protocol: 'rdap' });
if (!stored) throw new Error('the lookup cached nothing');

// the key the example's KV cache files a lookup under (examples/worker/src/index.ts)
const { key, hops } = stored;
writeFileSync(
  keyFile,
  `rdap-whois:${JSON.stringify([key.protocol, key.server, key.queryType, key.query, key.encoding])}`
);
writeFileSync(valueFile, JSON.stringify(hops));
