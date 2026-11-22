// a cache on Redis, shared by every process that uses it: a name asked again within the
// lifetime the client suggests makes no request. Run: REDIS_URL=redis://localhost:6379 npx tsx redis-cache.ts google.com
import { RdapWhois, reviveDates, type CacheKey, type HopCache } from '@aoxborrow/rdap-whois';
import { createClient } from 'redis';

const redis = await createClient({ url: process.env.REDIS_URL }).connect();

const id = (key: CacheKey) =>
  `rdap-whois:${JSON.stringify([key.protocol, key.server, key.queryType, key.query, key.encoding])}`;

const redisCache: HopCache = {
  get: async key => {
    const text = await redis.get(id(key));
    return text ? reviveDates(JSON.parse(text)) : null;
  },
  // the client's lifetime is in milliseconds, Redis's EX in seconds
  set: async (key, hops, ttl) => {
    await redis.set(id(key), JSON.stringify(hops), { EX: Math.ceil(ttl / 1000) });
  },
};

const client = new RdapWhois({ cache: redisCache });
const name = process.argv[2] ?? 'example.com';
try {
  for (const round of ['first', 'second']) {
    const started = Date.now();
    const { query, record } = await client.lookup(name);
    console.log(
      `${round} lookup of ${query}: ${record.registrar?.name ?? 'no registrar'} in ${Date.now() - started} ms`
    );
  }
} finally {
  await redis.quit();
}
