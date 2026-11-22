import { TimeoutError, type ErrorDetails } from '../errors';

// A time limit as an AbortSignal. The signal aborts with a TimeoutError when the time runs
// out, or with the parent's own reason when the parent aborts first, so whatever is waiting
// can reject with `signal.reason` and the caller gets the right error either way.
export interface Deadline {
  signal: AbortSignal;
  // stop the timer and stop listening to the parent. Always call this when the work is done
  clear(): void;
}

export function deadline(
  ms: number,
  message: string,
  parent?: AbortSignal,
  details: ErrorDetails = {}
): Deadline {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);

  if (parent?.aborted) {
    controller.abort(parent.reason);
    return { signal: controller.signal, clear: () => {} };
  }

  const timer = setTimeout(() => controller.abort(new TimeoutError(message, details)), ms);
  parent?.addEventListener('abort', onParentAbort, { once: true });

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

// wait for a promise, giving up when the signal aborts. Rejects with the signal's reason
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // the work was started anyway; its own failure must not surface as unhandled
    promise.catch(() => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

// what to reject with when a signal has aborted: the signal's own reason, which is a
// DOMException named AbortError (or TimeoutError, from AbortSignal.timeout()) unless the
// caller aborted with a reason of their own. A reason that is not an error becomes an
// AbortError with it as the message
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException(
    typeof reason === 'string' ? reason : 'The operation was aborted',
    'AbortError'
  );
}

// resolve after a delay, or reject as soon as the signal aborts
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return abortable(
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
    }),
    signal
  );
}
