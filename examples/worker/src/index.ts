// a Worker that answers GET /?name=example.com with the registration record, as JSON.
// `&protocol=rdap` or `&protocol=whois` asks one protocol only. Answers are kept in Workers KV,
// so a name asked again within the hour costs no request to its registry
import {
  RdapWhois,
  RdapWhoisError,
  reviveDates,
  type CacheKey,
  type HopCache,
  type Protocol,
} from '@aoxborrow/rdap-whois';

interface Env {
  CACHE: KVNamespace;
}

const id = (key: CacheKey) =>
  `rdap-whois:${JSON.stringify([key.protocol, key.server, key.queryType, key.query, key.encoding])}`;

const kvCache = (kv: KVNamespace): HopCache => ({
  get: async key => {
    const text = await kv.get(id(key));
    return text ? reviveDates(JSON.parse(text)) : null;
  },
  // KV takes seconds, 60 at the least; the client's lifetime is in milliseconds
  set: (key, hops, ttl) =>
    kv.put(id(key), JSON.stringify(hops), { expirationTtl: Math.max(60, Math.ceil(ttl / 1000)) }),
});

// one client per isolate, made on the first request (the KV binding comes with it), so its
// per-server limits hold across every request the isolate serves
let client: RdapWhois | undefined;

export default {
  async fetch(request, env): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const name = params.get('name');
    if (!name) return Response.json({ error: 'give ?name=' }, { status: 400 });
    const protocol = params.get('protocol');
    if (protocol !== null && protocol !== 'rdap' && protocol !== 'whois') {
      return Response.json({ error: 'protocol is rdap or whois' }, { status: 400 });
    }

    client ??= new RdapWhois({ cache: kvCache(env.CACHE) });
    try {
      const result = await client.lookup(name, {
        ...(protocol ? { protocol: protocol as Protocol } : {}),
      });
      return Response.json(result);
    } catch (error) {
      if (!(error instanceof RdapWhoisError)) throw error;
      const status =
        error.name === 'InvalidQueryError' ? 400 : error.name === 'NoServerError' ? 404 : 502;
      return Response.json({ error: error.toJSON() }, { status });
    }
  },
} satisfies ExportedHandler<Env>;
