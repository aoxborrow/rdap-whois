import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import knownLimits from '../../data/limits.json';
import { KNOWN_SERVER_LIMITS, ServerLimiter } from '../../src/net/limiter';

// a task that records when it started and finishes when told to
function tracker() {
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  const task = (name: string) => () =>
    new Promise<string>(resolve => {
      started.push(name);
      finishers.set(name, () => resolve(name));
    });
  return { started, task, finish: (name: string) => finishers.get(name)?.() };
}

describe('ServerLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs up to the concurrency limit and queues the rest', async () => {
    const limiter = new ServerLimiter({ concurrency: 2, minInterval: 0 });
    const { started, task, finish } = tracker();

    const runs = ['a', 'b', 'c'].map(name => limiter.run('whois.example.com', task(name)));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b']);
    expect(limiter.pending('whois.example.com')).toBe(1);

    finish('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b', 'c']);

    finish('b');
    finish('c');
    expect(await Promise.all(runs)).toEqual(['a', 'b', 'c']);
  });

  it('spaces the starts of requests to one server', async () => {
    const limiter = new ServerLimiter({ concurrency: 5, minInterval: 250 });
    const { started, task } = tracker();

    for (const name of ['a', 'b', 'c']) void limiter.run('whois.example.com', task(name));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(249);
    expect(started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(250);
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('applies a published limit by default, below the caller entries', async () => {
    // whois.punktum.dk publishes one request a second per address
    const spaced = new ServerLimiter({ concurrency: 5, minInterval: 0 });
    const { started, task, finish } = tracker();
    for (const name of ['a', 'b']) void spaced.run('whois.punktum.dk', task(name));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a']);
    finish('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(KNOWN_SERVER_LIMITS['whois.punktum.dk'].minInterval);
    expect(started).toEqual(['a', 'b']);

    // a caller's entry for the server wins
    const open = new ServerLimiter({
      concurrency: 1,
      minInterval: 1000,
      serverLimits: { 'whois.punktum.dk': { concurrency: 5, minInterval: 0 } },
    });
    const other = tracker();
    for (const name of ['a', 'b']) void open.run('whois.punktum.dk', other.task(name));
    await vi.advanceTimersByTimeAsync(0);
    expect(other.started).toEqual(['a', 'b']);
  });

  it('refuses a limit that would never let a request start', () => {
    expect(() => new ServerLimiter({ concurrency: 0, minInterval: 0 })).toThrow(RangeError);
    expect(() => new ServerLimiter({ concurrency: 1, minInterval: -1 })).toThrow(RangeError);
    expect(
      () =>
        new ServerLimiter({
          concurrency: 1,
          minInterval: 0,
          serverLimits: { 'whois.example.com': { concurrency: 0, minInterval: 0 } },
        })
    ).toThrow(/serverLimits\["whois.example.com"\]/);
  });

  it('keeps every published limit sourced and no looser than one request at a time', () => {
    for (const [server, entry] of Object.entries(knownLimits.servers)) {
      expect(entry.source, server).toMatch(/^https:\/\//);
      expect(entry.concurrency, server).toBeGreaterThanOrEqual(1);
      expect(entry.minInterval, server).toBeGreaterThan(0);
      expect(KNOWN_SERVER_LIMITS[server]).toEqual({
        concurrency: entry.concurrency,
        minInterval: entry.minInterval,
      });
    }
  });

  it('limits each server on its own', async () => {
    const limiter = new ServerLimiter({ concurrency: 1, minInterval: 1000 });
    const { started, task } = tracker();

    void limiter.run('whois.one.example', task('one-a'));
    void limiter.run('whois.one.example', task('one-b'));
    void limiter.run('whois.two.example', task('two-a'));
    await vi.advanceTimersByTimeAsync(0);
    // the second server is not held back by the first one's queue
    expect(started).toEqual(['one-a', 'two-a']);
  });

  it('uses a server’s own limit when it has one', async () => {
    const limiter = new ServerLimiter({
      concurrency: 1,
      minInterval: 0,
      serverLimits: { 'WHOIS.Fast.example': { concurrency: 3, minInterval: 0 } },
    });
    const { started, task } = tracker();

    for (const name of ['a', 'b', 'c']) void limiter.run('WHOIS.fast.example', task(name));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('frees the slot when a task fails', async () => {
    const limiter = new ServerLimiter({ concurrency: 1, minInterval: 0 });
    const { started, task } = tracker();

    const failing = limiter.run('whois.example.com', () => Promise.reject(new Error('boom')));
    void limiter.run('whois.example.com', task('next'));
    await expect(failing).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['next']);
  });

  it('holds back a paused server, and only that server', async () => {
    const limiter = new ServerLimiter({ concurrency: 2, minInterval: 0 });
    const { started, task } = tracker();

    limiter.pause('whois.slow.example', 5000);
    void limiter.run('whois.slow.example', task('slow'));
    void limiter.run('whois.other.example', task('other'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(started).toEqual(['other']);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(['other', 'slow']);
  });

  it('gives up a queued place when the caller aborts', async () => {
    const limiter = new ServerLimiter({ concurrency: 1, minInterval: 0 });
    const { started, task, finish } = tracker();
    const controller = new AbortController();

    void limiter.run('whois.example.com', task('running'));
    const waiting = limiter.run('whois.example.com', task('abandoned'), controller.signal);
    void limiter.run('whois.example.com', task('patient'));
    await vi.advanceTimersByTimeAsync(0);

    controller.abort(new Error('caller gave up'));
    await expect(waiting).rejects.toThrow('caller gave up');
    expect(limiter.pending('whois.example.com')).toBe(1);

    finish('running');
    await vi.advanceTimersByTimeAsync(0);
    // the abandoned request never started, and did not block the one behind it
    expect(started).toEqual(['running', 'patient']);
  });
});

// Cloudflare Workers ties a timer to the request that created it, and drops it once that
// request has finished. A request context is modelled here with AsyncLocalStorage
describe('ServerLimiter on Workers', () => {
  it('arms the wake-up timer in the waiting request, not the one that finished', async () => {
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const context = new AsyncLocalStorage<string>();
    const armedBy: (string | undefined)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      ms?: number
    ) => {
      armedBy.push(context.getStore());
      return realSetTimeout(handler, ms);
    }) as typeof setTimeout);
    try {
      const limiter = new ServerLimiter({ concurrency: 1, minInterval: 30 });
      const first = context.run('a', () => limiter.run('rdap.example', async () => 'a'));
      const second = context.run('b', () => limiter.run('rdap.example', async () => 'b'));
      expect(await Promise.all([first, second])).toEqual(['a', 'b']);
      // the only timer is the one that wakes b, and b armed it
      expect(armedBy).toEqual(['b']);
    } finally {
      spy.mockRestore();
    }
  });
});
