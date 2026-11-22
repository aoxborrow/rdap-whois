// The combined client: RDAP and WHOIS behind one object, and lookup(), which asks RDAP first
// and falls back to WHOIS, and turns the answers into one normalized record. The WHOIS side
// (its parser, per-server formats and TLD table) is loaded the first time a call needs it,
// so a program that only ever uses RDAP never loads it.
import {
  DOMAIN_QUERY_TYPE,
  IANA_SERVER_TYPE,
  REGISTRAR_SERVER_TYPE,
  REGISTRY_SERVER_TYPE,
  UNKNOWN_SERVER_TYPE,
  type ServerType,
} from './common/constants';
import {
  Core,
  type CallOptions,
  type FallbackEvent,
  type ResolvedOptions,
  type RdapWhoisOptions,
  type Running,
} from './core';
import {
  InvalidQueryError,
  InvalidResponseError,
  NoServerError,
  NoUsableAnswerError,
  toErrorInfo,
  type ErrorInfo,
  type Protocol,
} from './errors';
import { isDomainShaped, normalizeQuery } from './query';
import { rdapCall, type RdapCallOptions, type RdapHop } from './rdap/client';
import { getRdapServer, getRdapZone } from './rdap/servers';
import { registrableDomain } from './registrable';
import {
  combineHops,
  describesTld,
  availableRecord,
  isUsableRecord,
  rdapRecordHop,
  whoisRecordHop,
  type Discrepancy,
  type DomainRecord,
  type RecordHop,
  type RecordProvenance,
} from './record/record';
import { withoutRedacted } from './record/redaction';
import type { WhoisCallOptions, WhoisHop } from './whois/client';

/**
 * lookup() takes every call option. A registrar that fails or has no record after the
 * registry answered leaves the registry's answer standing, with the failed hop in `attempts`
 */
export interface LookupOptions extends CallOptions {
  /** use only this protocol, instead of RDAP first and WHOIS as the fallback */
  protocol?: Protocol;
  /**
   * also return how the record was built: every server's answer, where each group of the
   * record came from, and where the registry and the registrar disagree
   */
  verbose?: boolean;
  /**
   * make the placeholder text a server writes for a value it withheld ("REDACTED FOR
   * PRIVACY") null in the record, as if the server had not sent it. Off by default, so values
   * come back as sent; the text is always in `attempts`.
   */
  nullRedacted?: boolean;
}

/** lookup()'s options with `verbose` set, which type the result as a VerboseLookupResult */
export type VerboseLookupOptions = LookupOptions & { verbose: true };

/**
 * one protocol's part in a lookup. `hops` is every server asked, in order, with what each
 * said, and `protocol` says which kind of hop they are: checking it narrows `hops`
 */
export type LookupAttempt = (
  { protocol: 'rdap'; hops: RdapHop[] } | { protocol: 'whois'; hops: WhoisHop[] }
) & {
  /**
   * why the protocol lookup failed as a whole, when it did. When it gave no usable answer
   * because an answer could not be read, this is why it could not
   */
  error?: ErrorInfo;
};

/** the server whose answer the result rests on */
export interface LookupSourceInfo {
  protocol: Protocol;
  server: string;
  serverType: ServerType;
  /** the URL that answered, for RDAP */
  url?: string;
}

export interface LookupResult {
  /** the name that was looked up, in ASCII */
  query: string;
  /**
   * what is known about the domain: `available` when the registry said the name does not
   * exist, `reserved` when it holds the name back, and otherwise a registered name's data
   */
  record: DomainRecord;
  /** the server the record is based on: the registrar's when it answered, else the registry's */
  source: LookupSourceInfo;
}

/** what lookup() returns with `verbose: true` */
export interface VerboseLookupResult extends LookupResult {
  /** every protocol tried, in order, with each server's answer as it was sent */
  attempts: LookupAttempt[];
  /** which server each group of the record came from; null for an available name */
  provenance: RecordProvenance | null;
  /** fields where the registry and the registrar disagree */
  discrepancies: Discrepancy[];
}

/** one name's outcome in a batch: its result, or what its lookup threw. `ok` says which */
export type LookupManyItem<R extends LookupResult = LookupResult> =
  { query: string; ok: true; result: R } | { query: string; ok: false; error: unknown };

// the WHOIS client module, loaded the first time a call needs it
type WhoisModule = typeof import('./whois/client');
let whoisModule: Promise<WhoisModule> | undefined;
const loadWhois = (): Promise<WhoisModule> => (whoisModule ??= import('./whois/client'));

export class RdapWhois {
  private readonly core: Core;

  constructor(options: RdapWhoisOptions = {}) {
    this.core = new Core(options);
  }

  private get options(): ResolvedOptions {
    return this.core.options;
  }

  /**
   * Look a query up over WHOIS and return every server's answer in the order they were
   * asked: the registry's first, then the registrar's when the registry referred to one.
   *
   * The first server failing is thrown, a throttle once retries run out. A server that says
   * it has no such object is a hop with status 'notfound', and a referral that fails is a
   * hop with status 'error' next to the hops that answered.
   */
  async whois(query: string, callOptions: WhoisCallOptions = {}): Promise<WhoisHop[]> {
    const { whoisCall } = await loadWhois();
    return this.core.inRun(this.core.merge(callOptions), options =>
      whoisCall(this.core, query, options)
    );
  }

  /**
   * Look a query up over RDAP and return every server's answer in the order they were
   * asked: the registry's first, then the registrar's when the registry links to one.
   *
   * The first server failing is thrown, a throttle once retries run out. A server that says
   * it has no such object is a hop with status 'notfound', and a referral that fails is a
   * hop with status 'error' next to the hops that answered.
   */
  async rdap(query: string, callOptions: RdapCallOptions = {}): Promise<RdapHop[]> {
    return this.core.inRun(this.core.merge(callOptions), options =>
      rdapCall(this.core, query, options)
    );
  }

  // what one protocol's hops amount to: a usable record, an authoritative "no such name",
  // or neither
  private evaluate(
    attempt: LookupAttempt,
    query: string,
    options: ResolvedOptions & LookupOptions
  ): {
    usable: { record: DomainRecord; hop: RdapHop | WhoisHop; serverType: ServerType } | null;
    combined: ReturnType<typeof combineHops>;
    negative: RdapHop | WhoisHop | null;
    // the registry said it has the name, whether or not a record came of it
    claimed: boolean;
    failure: Error | null;
    insufficient: boolean;
    unreadable: unknown;
  } {
    const { protocol } = attempt;
    const hops: (RdapHop | WhoisHop)[] = attempt.hops;
    // the first answer that could not be made into a record, and what the transform threw
    let unreadable: unknown = undefined;
    const nothing = {
      usable: null,
      combined: null,
      negative: null,
      claimed: false,
      failure: null,
      unreadable,
    };

    // IANA is the authority for a TLD, not for a name under one. When the lookup starts at
    // IANA (a TLD the routing data has no server for), the server IANA's record names is
    // the TLD's registry, whatever the routing data calls it, and the authority from there
    const viaIana =
      hops[0]?.serverType === IANA_SERVER_TYPE && query.includes('.') && hops.length > 1;
    const authority = viaIana ? 1 : 0;

    // an authoritative answer comes from the first server with authority only, and only
    // when that server is the registry. A registrar saying it has no such name is not one
    const first = hops[authority];
    const registry =
      first !== undefined &&
      (viaIana ||
        (first.serverType !== REGISTRAR_SERVER_TYPE &&
          first.serverType !== UNKNOWN_SERVER_TYPE &&
          (first.serverType !== IANA_SERVER_TYPE || !query.includes('.'))));
    const negative =
      registry && first.status === 'notfound'
        ? viaIana
          ? ({ ...first, serverType: REGISTRY_SERVER_TYPE } as typeof first)
          : first
        : null;
    const claimed = hops.some(
      (hop, index) =>
        (hop.status === 'found' || hop.status === 'reserved') &&
        ((index === authority && registry) || hop.serverType === REGISTRY_SERVER_TYPE)
    );

    const answered: { hop: RdapHop | WhoisHop; serverType: ServerType; record: RecordHop }[] = [];
    for (const [index, hop] of hops.entries()) {
      if (hop.status !== 'found' && hop.status !== 'reserved') continue;
      // the server IANA pointed to is the registry, whatever the routing data calls it. A
      // server the registry referred to that the data does not know is, for the record, the
      // registrar: its answer goes on top of the registry's
      const serverType =
        viaIana && index === authority
          ? REGISTRY_SERVER_TYPE
          : index > authority && hop.serverType === UNKNOWN_SERVER_TYPE
            ? REGISTRAR_SERVER_TYPE
            : hop.serverType;
      let record: RecordHop | null;
      try {
        record =
          attempt.protocol === 'rdap'
            ? rdapRecordHop(query, serverType, attempt.hops[index].data, options.validate)
            : whoisRecordHop(
                query,
                serverType,
                attempt.hops[index].data,
                hop.status === 'reserved'
              );
      } catch (error) {
        if (!(error instanceof InvalidResponseError)) {
          // an answer the record could not be made from: a bug in the transform, or a
          // response shaped like nothing it knows. It is passed over like a hop with no
          // answer, and the error is kept so the lookup can say why it found nothing
          unreadable ??= error;
          this.core.emit(options, {
            type: 'transform-error',
            protocol,
            server: hop.server,
            error: toErrorInfo(error),
          });
          continue;
        }
        // an answer about some other domain, as hops from a cache can hold and as a WHOIS
        // server gives for a zone or a host (rdap() refuses its own the same way): from the
        // first server it fails the protocol, as rdap()
        // throws it, and from a referral it is a failed referral, which leaves the answers
        // before it standing
        if (index === 0) {
          const failure = new InvalidResponseError(`${hop.server} ${error.message}`, {
            protocol,
            server: hop.server,
            query,
          });
          return { ...nothing, failure, insufficient: false };
        }
        continue;
      }
      // an answer that is not a domain record is passed over, like a failed referral
      if (record) answered.push({ hop, serverType, record });
    }
    const sent = combineHops(answered.map(entry => entry.record));
    if (!sent) return { ...nothing, negative, claimed, insufficient: false, unreadable };

    // whether an answer is usable is judged on what the servers sent, so keeping or dropping
    // redacted values never changes which server answers
    const acceptable =
      (isUsableRecord(sent.record) || sent.record.reserved) && !describesTld(sent.record, query);
    if (!acceptable) return { ...nothing, negative, claimed, insufficient: true, unreadable };

    // with nullRedacted, the record is then built from each answer without its redacted
    // values, so a side whose contacts were all redacted gives none, and the other side's are
    // taken
    const combined = options.nullRedacted
      ? combineHops(
          answered.map(entry => ({ ...entry.record, record: withoutRedacted(entry.record.record) }))
        )!
      : sent;
    const { hop, serverType } = answered.find(entry => entry.record === sent.base)!;
    return {
      usable: { record: combined.record, hop, serverType },
      combined,
      negative,
      claimed,
      failure: null,
      insufficient: false,
      unreadable,
    };
  }

  /**
   * Look a domain up and return one answer: RDAP where the TLD has an RDAP server, WHOIS
   * otherwise or as the fallback.
   *
   * The answer is a record: `available` when the registry itself said the name does not
   * exist, `reserved` when the registry holds it back, and otherwise the registered name's
   * data. Anything else is thrown: a TLD with no server to ask is a NoServerError, a timeout
   * or a throttle is never reported as available, and servers that answered with too little
   * to use are a NoUsableAnswerError.
   *
   * With `verbose`, the result also has every server's answer (`attempts`), where each group
   * of the record came from and where the registry and the registrar disagree.
   */
  async lookup(query: string, callOptions: VerboseLookupOptions): Promise<VerboseLookupResult>;
  async lookup(query: string, callOptions?: LookupOptions): Promise<LookupResult>;
  async lookup(query: string, callOptions: LookupOptions = {}): Promise<LookupResult> {
    const result = await this.core.inRun(this.core.merge(callOptions), options =>
      this.lookupCall(query, options)
    );
    if (callOptions.verbose) return result;
    const { query: name, record, source } = result;
    return { query: name, record, source };
  }

  private async lookupCall(
    query: string,
    options: Running<ResolvedOptions & LookupOptions>
  ): Promise<VerboseLookupResult> {
    if (!isDomainShaped(query)) {
      throw new InvalidQueryError(
        `"${query}" is not a domain name; use whois() or rdap() for anything else`,
        { query }
      );
    }
    // a host is looked up as the registered name it is under: the registry has no record
    // of www.google.com, and saying so would read as the name being free. A suffix on its
    // own (co.uk, com) is asked about as it is
    const text = registrableDomain(query) ?? normalizeQuery(query, DOMAIN_QUERY_TYPE);

    // which protocols have a server for this name. WHOIS has IANA to try under a TLD the
    // routing data does not list, which can point at a server the data does not know, but only a registry's own server
    // counts as having one. The WHOIS side is loaded only when WHOIS may be asked
    const order: Protocol[] = options.protocol ? [options.protocol] : ['rdap', 'whois'];
    const whois = order.includes('whois') ? await loadWhois() : null;
    // whether WHOIS is asked at all: a TLD the routing data lists with no server (.dev)
    // relies on RDAP alone, while an unlisted one still has IANA to try
    const asksWhois = Boolean(whois?.getWhoisServer(DOMAIN_QUERY_TYPE, text));
    const hasServer = {
      rdap: Boolean(getRdapServer(DOMAIN_QUERY_TYPE, text)),
      whois: Boolean(whois?.hasTldServer(text)),
    };
    const run = {
      rdap: async (q: string): Promise<LookupAttempt> => ({
        protocol: 'rdap',
        hops: await rdapCall(this.core, q, {
          ...options,
          // lookup() asks the servers the routing data names, never one of the caller's
          server: undefined,
          queryType: DOMAIN_QUERY_TYPE,
        }),
      }),
      whois: async (q: string): Promise<LookupAttempt> => ({
        protocol: 'whois',
        hops: await whois!.whoisCall(this.core, q, {
          ...options,
          server: undefined,
          port: undefined,
          queryType: DOMAIN_QUERY_TYPE,
        }),
      }),
    };

    const attempts: LookupAttempt[] = [];
    const failures: unknown[] = [];
    // the last answer that could not be read, the cause when nothing usable came of it
    let unreadable: unknown = undefined;
    let negative: { protocol: Protocol; hop: RdapHop | WhoisHop } | null = null;
    // whether a registry said it has the name, in either protocol
    let claimed = false;

    for (const protocol of order) {
      // RDAP is only tried where the bootstrap data has a server for the TLD
      if (protocol === 'rdap' && !hasServer.rdap) continue;
      if (protocol === 'whois' && !asksWhois) continue;

      let reason: FallbackEvent['reason'] = 'insufficient';
      try {
        const attempt = await run[protocol](text);
        attempts.push(attempt);

        const outcome = this.evaluate(attempt, text, options);
        claimed ||= outcome.claimed;
        if (outcome.usable && outcome.combined) {
          const { record, hop, serverType } = outcome.usable;
          return {
            query: text,
            record,
            source: {
              protocol,
              server: hop.server,
              serverType,
              ...('url' in hop ? { url: hop.finalUrl ?? hop.url } : {}),
            },
            attempts,
            provenance: outcome.combined.provenance,
            discrepancies: outcome.combined.discrepancies,
          };
        }
        if (outcome.unreadable !== undefined) {
          unreadable = outcome.unreadable;
          attempts[attempts.length - 1].error = toErrorInfo(outcome.unreadable);
        }
        if (outcome.failure) {
          failures.push(outcome.failure);
          attempts[attempts.length - 1].error = toErrorInfo(outcome.failure);
          reason = 'error';
        } else if (outcome.negative) {
          // the first source to say so keeps the attribution
          negative ??= { protocol, hop: outcome.negative };
          reason = 'notfound';
          // the registry's own RDAP saying it has no such name is the answer, with or
          // without a body (Verisign sends none), unless the WHOIS data routes the name to a
          // registry below the one RDAP asked: Nominet's RDAP has no record of ox.ac.uk,
          // which JISC holds, nor Verisign's of a CentralNic name under br.com
          if (protocol === 'rdap' && outcome.negative.serverType === REGISTRY_SERVER_TYPE) {
            const whoisZone = whois?.getTldZone(text) ?? null;
            const rdapZone = getRdapZone(text);
            if (!whoisZone || (rdapZone !== null && rdapZone.length >= whoisZone.length)) break;
            // RDAP asked a registry above the one that holds the name, so its 404 says
            // nothing: only that registry's own answer, over WHOIS, can say the name is free
            negative = null;
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // whatever a source throws is an operational failure, kept as the object it was
        failures.push(error);
        attempts.push({ protocol, hops: [], error: toErrorInfo(error) });
        reason = 'error';
      }
      if (protocol === 'rdap' && asksWhois) {
        this.core.emit(options, { type: 'fallback', from: 'rdap', to: 'whois', reason });
      }
    }

    // a failure with no authoritative negative stays a failure: a timeout must never read
    // as "this name is free"
    if (!negative && failures.length) throw failures[failures.length - 1];

    // and so does a registry having said it has the name, when nothing usable came of it
    if (negative && !claimed) {
      const { protocol, hop } = negative;
      return {
        query: text,
        record: availableRecord(text),
        source: {
          protocol,
          server: hop.server,
          serverType: hop.serverType,
          ...('url' in hop ? { url: hop.finalUrl ?? hop.url } : {}),
        },
        attempts,
        provenance: null,
        discrepancies: [],
      };
    }

    // no server to ask is not an answer either way
    if (order.every(protocol => !hasServer[protocol])) {
      throw new NoServerError(`No RDAP or WHOIS server is known for "${text}"`, { query: text });
    }

    throw new NoUsableAnswerError(
      `No server gave a usable answer for "${text}", and none said it does not exist`,
      {
        query: text,
        attempts,
        ...(unreadable === undefined ? {} : { cause: unreadable }),
      }
    );
  }

  /**
   * Look up many names. Results arrive as each lookup finishes, not in the order given,
   * with `batchConcurrency` lookups in flight. Each server stays inside its own limit, so names
   * on different registries proceed side by side while one busy registry waits its turn.
   */
  lookupMany(
    queries: Iterable<string>,
    callOptions: VerboseLookupOptions
  ): AsyncGenerator<LookupManyItem<VerboseLookupResult>>;
  lookupMany(
    queries: Iterable<string>,
    callOptions?: LookupOptions
  ): AsyncGenerator<LookupManyItem>;
  async *lookupMany(
    queries: Iterable<string>,
    callOptions: LookupOptions = {}
  ): AsyncGenerator<LookupManyItem> {
    const concurrency = this.core.merge(callOptions).batchConcurrency;
    const iterator = queries[Symbol.iterator]();
    const inFlight = new Map<number, Promise<{ id: number; item: LookupManyItem }>>();
    let nextId = 0;

    const start = (): boolean => {
      const next = iterator.next();
      if (next.done) return false;
      const id = nextId++;
      const query = next.value;
      inFlight.set(
        id,
        this.lookup(query, callOptions).then(
          result => ({ id, item: { query, ok: true, result } }),
          (error: unknown) => ({ id, item: { query, ok: false, error } })
        )
      );
      return true;
    };

    while (inFlight.size < concurrency && start());
    while (inFlight.size) {
      const { id, item } = await Promise.race(inFlight.values());
      inFlight.delete(id);
      start();
      yield item;
    }
  }

  /** lookupMany(), collected: every outcome, in the order the names were given */
  async lookupAll(
    queries: Iterable<string>,
    callOptions: VerboseLookupOptions
  ): Promise<LookupManyItem<VerboseLookupResult>[]>;
  async lookupAll(
    queries: Iterable<string>,
    callOptions?: LookupOptions
  ): Promise<LookupManyItem[]>;
  async lookupAll(
    queries: Iterable<string>,
    callOptions: LookupOptions = {}
  ): Promise<LookupManyItem[]> {
    const names = [...queries];
    const byQuery = new Map<string, LookupManyItem[]>();
    for await (const item of this.lookupMany(names, callOptions)) {
      const list = byQuery.get(item.query) ?? [];
      list.push(item);
      byQuery.set(item.query, list);
    }
    return names.map(name => byQuery.get(name)!.shift()!);
  }
}

// the client behind lookup(), whois() and rdap() below, made the first time one is called
// and shared by every caller in the program, its per-server limits included
let defaultClient: RdapWhois | undefined;
const shared = (): RdapWhois => (defaultClient ??= new RdapWhois());

/**
 * RdapWhois.lookup() on a client with the default options, shared across the program.
 * Construct an RdapWhois of your own for a proxy, a cache or other limits
 */
export function lookup(query: string, options: VerboseLookupOptions): Promise<VerboseLookupResult>;
export function lookup(query: string, options?: LookupOptions): Promise<LookupResult>;
export function lookup(query: string, options?: LookupOptions): Promise<LookupResult> {
  return shared().lookup(query, options);
}

/** RdapWhois.whois() on the shared default client */
export const whois = (query: string, options?: WhoisCallOptions): Promise<WhoisHop[]> =>
  shared().whois(query, options);

/** RdapWhois.rdap() on the shared default client */
export const rdap = (query: string, options?: RdapCallOptions): Promise<RdapHop[]> =>
  shared().rdap(query, options);
