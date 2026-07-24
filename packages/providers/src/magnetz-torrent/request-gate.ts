const DEFAULT_NOW = Date.now;

export interface MagnetzRequestGateOptions {
  intervalMs: number;
  now?: () => number;
}

// Serializes starts from one provider instance and leaves a small gap between them. The live API
// advertises a 30-request header but has also returned short burst 429 responses below that count.
export class MagnetzRequestGate {
  readonly #intervalMs: number;
  readonly #now: () => number;
  #tail: Promise<void> = Promise.resolve();
  #nextStartAt = 0;

  constructor(options: MagnetzRequestGateOptions) {
    this.#intervalMs = options.intervalMs;
    this.#now = options.now ?? DEFAULT_NOW;
  }

  async wait(signal?: AbortSignal): Promise<void> {
    const previous = this.#tail;
    let release: () => void = () => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tail = previous.then(() => turn);

    try {
      await waitForPromise(previous, signal);
      await abortableDelay(Math.max(0, this.#nextStartAt - this.#now()), signal);
      this.#nextStartAt = this.#now() + this.#intervalMs;
    } finally {
      release();
    }
  }
}

function waitForPromise(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return signal?.aborted ? Promise.reject(signal.reason) : Promise.resolve();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
