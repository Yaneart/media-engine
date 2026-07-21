import type { MediaEngineOperationOptions } from "./types.js";
import { getAbortReason, OperationCancelledError, throwIfAborted } from "./operation.js";

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  settled: boolean;
}

interface InFlightCaller {
  run<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T>;
  joinExisting<T>(key: string): Promise<T> | undefined;
}

// Coalesces identical work while giving every caller an independently cancellable subscription.
// Объединяет одинаковую работу и дает каждому caller независимо отменяемую подписку.
export class InFlightRequestCoalescer {
  private readonly requests = new Map<string, SharedRequest<unknown>>();

  forCaller(options: MediaEngineOperationOptions = {}): InFlightCaller {
    return {
      run: (key, load) => this.run(key, load, options),
      joinExisting: (key) => this.joinExisting(key, options),
    };
  }

  // Subscribes to matching work only when another caller already started it.
  // Подписывается на совпадающую работу, только если другой caller уже ее запустил.
  joinExisting<T>(key: string, options: MediaEngineOperationOptions = {}): Promise<T> | undefined {
    if (options.signal?.aborted) {
      return Promise.reject(getAbortReason(options.signal));
    }

    const shared = this.requests.get(key) as SharedRequest<T> | undefined;
    return shared ? this.subscribe(key, shared, options.signal) : undefined;
  }

  run<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: MediaEngineOperationOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(getAbortReason(options.signal));
    }

    let shared = this.requests.get(key) as SharedRequest<T> | undefined;

    if (!shared) {
      shared = this.createSharedRequest(key, load);
    }

    return this.subscribe(key, shared, options.signal);
  }

  private createSharedRequest<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
  ): SharedRequest<T> {
    const controller = new AbortController();
    const shared: SharedRequest<T> = {
      controller,
      promise: Promise.resolve().then(() => {
        throwIfAborted(controller.signal);
        return load(controller.signal);
      }),
      subscribers: 0,
      settled: false,
    };

    this.requests.set(key, shared as SharedRequest<unknown>);
    void shared.promise.then(
      () => this.settle(key, shared),
      () => this.settle(key, shared),
    );

    return shared;
  }

  private subscribe<T>(
    key: string,
    shared: SharedRequest<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    shared.subscribers += 1;

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        signal?.removeEventListener("abort", onAbort);
        shared.subscribers -= 1;
        callback();

        if (shared.subscribers === 0 && !shared.settled && !shared.controller.signal.aborted) {
          if (this.requests.get(key) === shared) {
            this.requests.delete(key);
          }

          shared.controller.abort(new OperationCancelledError());
        }
      };
      const onAbort = () => finish(() => reject(getAbortReason(signal!)));

      signal?.addEventListener("abort", onAbort, { once: true });
      shared.promise.then(
        (value) => finish(() => resolve(cloneResult(value))),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private settle<T>(key: string, shared: SharedRequest<T>): void {
    shared.settled = true;

    if (this.requests.get(key) === shared) {
      this.requests.delete(key);
    }
  }
}

function cloneResult<T>(value: T): T {
  return structuredClone(value);
}
