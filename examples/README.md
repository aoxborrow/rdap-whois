# Examples

Small, complete programs against `@aoxborrow/rdap-whois`. They are type-checked in CI, and
`parse-only.ts`, which needs no network, is run there too, so they cannot drift from the API.

| Example | What it shows |
| --- | --- |
| [`lookup.ts`](./lookup.ts) | One lookup on the shared default client, reading the record and telling failures apart by class |
| [`availability.ts`](./availability.ts) | Many names with `lookupMany()`: available, reserved or registered, and the failures worth retrying later |
| [`parse-only.ts`](./parse-only.ts) | `parseWhois()` on a saved response, with no network |
| [`proxy.ts`](./proxy.ts) | A proxy for both protocols, or one for each, from environment variables |
| [`redis-cache.ts`](./redis-cache.ts) | The `HopCache` interface on Redis, with `reviveDates()` |
| [`worker/`](./worker) | A Cloudflare Worker with one client per isolate and a Workers KV cache |

```bash
npm install && npm run build         # in the package root: the examples use its dist/
cd examples
npm ci                               # redis, wrangler and the types, from the lockfile
npx tsx lookup.ts google.com
npx tsx availability.ts example.com example.org nonexistent-name-0219.com
npx tsx parse-only.ts
npm run worker                       # then open http://localhost:8787/?name=google.com
npm run typecheck
```

Their tsconfigs map `@aoxborrow/rdap-whois` to the package's `dist/`, so `tsc`, `tsx` and
`wrangler` all use the build, as an installed package would be: run `npm run build` in the
package root again after changing its source. In your own project, install
`@aoxborrow/rdap-whois` from npm and the imports are the same.
