import { TorrServerClientError } from './errors';

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: TorrServerClientError) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class TorrServerRequestGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(signal);

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal | undefined): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(cancelledError());
    }

    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

      if (signal !== undefined) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);

          if (index >= 0) {
            this.waiters.splice(index, 1);
            reject(cancelledError());
          }
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      const waiter = this.waiters.shift();

      if (waiter === undefined) {
        this.active -= 1;
        return;
      }

      if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }

      waiter.resolve(this.createRelease());
    };
  }
}

function cancelledError(): TorrServerClientError {
  return new TorrServerClientError(
    'aborted',
    'TorServer request was cancelled.',
  );
}
