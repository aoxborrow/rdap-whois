import knownLimits from '../../data/limits.json';
import { abortReason } from './deadline';

// A rate limiter keyed by server. It sits under every request, so one registry never sees
// more than its limit from this client whether the requests come from a single lookup, a
// referral or a batch, and a throttle from one server holds back only that server's queue.

export interface ServerLimit {
  /** requests in flight to one server at a time */
  concurrency: number;
  /** the shortest time between two requests starting, in milliseconds */
  minInterval: number;
}

// how the client limits the requests to each server
export interface LimiterSettings {
  // requests in flight to one server at a time, for a server with no limit of its own
  concurrency: number;
  // the shortest time between two requests to one server starting, in milliseconds, for a
  // server with no limit of its own
  minInterval: number;
  // limits by server hostname. An entry wins over the published limit for that server
  serverLimits?: Record<string, ServerLimit>;
}

export const DEFAULT_SERVER_LIMIT: ServerLimit = { concurrency: 2, minInterval: 250 };

// a limit the caller set, checked: a server that may have no request in flight would never
// be asked at all, which is a mistake in the settings
function checkLimit(limit: ServerLimit, where: string): ServerLimit {
  if (!(limit.concurrency >= 1)) {
    throw new RangeError(`${where}concurrency must be 1 or more, not ${limit.concurrency}`);
  }
  if (!(limit.minInterval >= 0)) {
    throw new RangeError(`${where}minInterval must be 0 or more, not ${limit.minInterval}`);
  }
  return { concurrency: limit.concurrency, minInterval: limit.minInterval };
}

/**
 * the limits registries publish for their servers, by hostname. data/limits.json gives
 * the source of each
 */
export const KNOWN_SERVER_LIMITS: Readonly<Record<string, ServerLimit>> = Object.freeze(
  Object.fromEntries(
    Object.entries(knownLimits.servers).map(([server, { concurrency, minInterval }]) => [
      server,
      Object.freeze({ concurrency, minInterval }),
    ])
  )
);

interface Waiter {
  start: () => void;
  fail: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  // the latest the request may start; a pause that ends later fails it at once
  latest?: number;
  // ask the waiter to wake the queue after ms, on a timer of its own
  arm: (ms: number) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface ServerState {
  active: number;
  // when the next request to this server may start
  nextStart: number;
  queue: Waiter[];
  // the server is paused until then, because of `pausedBy`
  pausedUntil?: number;
  pausedBy?: unknown;
}

export class ServerLimiter {
  private readonly states = new Map<string, ServerState>();
  private readonly fallback: ServerLimit;
  // the caller's entries, by lowercase hostname
  private readonly servers = new Map<string, ServerLimit>();

  constructor(
    settings: LimiterSettings = DEFAULT_SERVER_LIMIT,
    // injectable for tests
    private readonly now: () => number = Date.now
  ) {
    this.fallback = checkLimit(settings, '');
    for (const [server, limit] of Object.entries(settings.serverLimits ?? {})) {
      this.servers.set(server.toLowerCase(), checkLimit(limit, `serverLimits["${server}"].`));
    }
  }

  // the caller's entry for the server, else the limit its registry publishes, else the
  // client's own
  private limitFor(server: string): ServerLimit {
    return this.servers.get(server) ?? KNOWN_SERVER_LIMITS[server] ?? this.fallback;
  }

  private stateFor(server: string): ServerState {
    let state = this.states.get(server);
    if (!state) {
      state = { active: 0, nextStart: 0, queue: [] };
      this.states.set(server, state);
    }
    return state;
  }

  // start whatever may start now, and set a timer for the rest
  private drain(server: string): void {
    const state = this.stateFor(server);
    const limit = this.limitFor(server);

    while (state.queue.length && state.active < limit.concurrency) {
      const wait = state.nextStart - this.now();
      if (wait > 0) {
        state.queue[0].arm(wait);
        return;
      }
      const waiter = state.queue.shift()!;
      this.forget(waiter);
      state.active++;
      state.nextStart = this.now() + limit.minInterval;
      waiter.start();
    }

    // nothing waiting and nothing running: forget the server once its interval has passed
    if (!state.queue.length && !state.active && state.nextStart <= this.now()) {
      this.states.delete(server);
    }
  }

  private forget(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    waiter.arm = () => {};
    if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
  }

  // the error a pause holds the server back for, when it would hold back a request that
  // must start by `latest`
  private pausedPast(state: ServerState, latest: number | undefined): unknown {
    if (latest === undefined || state.pausedUntil === undefined) return undefined;
    if (state.pausedUntil <= this.now() || state.pausedUntil <= latest) return undefined;
    return state.pausedBy;
  }

  // Run `task` when this server's limit allows it. `latest` is the latest the request may
  // start: while the server is paused past it, the request fails at once with the error the
  // server was paused for, instead of waiting for nothing
  async run<T>(
    server: string,
    task: () => Promise<T>,
    signal?: AbortSignal,
    latest?: number
  ): Promise<T> {
    const key = server.toLowerCase();
    const state = this.stateFor(key);

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const paused = this.pausedPast(state, latest);
      if (paused !== undefined) {
        reject(paused);
        this.drain(key);
        return;
      }
      const waiter: Waiter = { start: resolve, fail: reject, signal, latest, arm: () => {} };
      const listen = () => {
        void new Promise<number>(wake => (waiter.arm = wake)).then(ms => {
          clearTimeout(waiter.timer);
          waiter.timer = setTimeout(() => this.drain(key), ms);
          listen();
        });
      };
      listen();
      if (signal) {
        // a request abandoned while it waits must not hold its place in the queue
        waiter.onAbort = () => {
          const index = state.queue.indexOf(waiter);
          if (index !== -1) state.queue.splice(index, 1);
          this.forget(waiter);
          reject(abortReason(signal));
          this.drain(key);
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      state.queue.push(waiter);
      this.drain(key);
    });

    try {
      return await task();
    } finally {
      state.active--;
      this.drain(key);
    }
  }

  // Hold back every request to this server for `ms`, e.g. after it answered with a
  // throttle, which is `reason`. A request waiting that must start before the pause ends
  // fails at once with `reason`
  pause(server: string, ms: number, reason?: unknown): void {
    if (ms <= 0) return;
    const key = server.toLowerCase();
    const state = this.stateFor(key);
    const until = this.now() + ms;
    state.nextStart = Math.max(state.nextStart, until);
    if (reason !== undefined && until >= (state.pausedUntil ?? 0)) {
      state.pausedUntil = until;
      state.pausedBy = reason;
      for (const waiter of [...state.queue]) {
        if (this.pausedPast(state, waiter.latest) === undefined) continue;
        state.queue.splice(state.queue.indexOf(waiter), 1);
        this.forget(waiter);
        waiter.fail(reason);
      }
    }
    this.drain(key);
  }

  // how many requests are waiting for this server
  pending(server: string): number {
    return this.states.get(server.toLowerCase())?.queue.length ?? 0;
  }
}
