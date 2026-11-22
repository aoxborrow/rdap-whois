// A cache for the client's `cache` option that keeps the hops in memory, in this process
// only. It holds at most `max` lookups: past that, the one used least recently goes. Each
// entry lives for the lifetime the client suggests when it stores it.
import type { CacheKey, CachedHops, HopCache } from './core';

export interface MemoryCacheOptions {
  // the most protocol lookups to keep. Default 1000
  max?: number;
}

interface Entry {
  hops: CachedHops;
  expires: number;
}

// one string for every part of the key, so two keys that differ anywhere never share an
// entry
const entryId = (key: CacheKey): string =>
  JSON.stringify([key.protocol, key.server, key.queryType, key.query, key.encoding ?? null]);

// The hops are copied going in and coming out, so a caller that changes the hops it was
// given cannot change what the cache answers next time
export function memoryCache(options: MemoryCacheOptions = {}): HopCache {
  const max = options.max ?? 1000;
  if (!(max >= 1)) throw new RangeError(`max must be 1 or more, not ${max}`);
  // a Map keeps its keys in the order they were set, so the first one is the one used
  // least recently once every hit is set again
  const entries = new Map<string, Entry>();

  return {
    get(key) {
      const id = entryId(key);
      const entry = entries.get(id);
      if (!entry) return undefined;
      entries.delete(id);
      if (entry.expires <= Date.now()) return undefined;
      entries.set(id, entry);
      return structuredClone(entry.hops);
    },
    set(key, hops, ttl) {
      const id = entryId(key);
      entries.delete(id);
      if (!(ttl > 0)) return;
      entries.set(id, { hops: structuredClone(hops), expires: Date.now() + ttl });
      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
  };
}
