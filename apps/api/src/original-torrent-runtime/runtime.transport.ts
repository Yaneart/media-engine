import type { OriginalTorrentRuntimeConfig } from './runtime.config';
import {
  isOriginalTorrentRuntimeError,
  OriginalTorrentRuntimeError,
} from './runtime.errors';

export type TorrServerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface RequestOptions {
  operation: string;
  init: () => RequestInit;
  signal?: AbortSignal;
  retryTransient: boolean;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: OriginalTorrentRuntimeError) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class TorrServerControlTransport {
  private readonly gate: BoundedRequestGate;

  constructor(
    private readonly config: OriginalTorrentRuntimeConfig,
    private readonly fetchImplementation: TorrServerFetch = fetch,
    private readonly delay: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void> = cancellableDelay,
  ) {
    this.gate = new BoundedRequestGate(
      config.maxConcurrency,
      config.maxQueueSize,
    );
  }

  request(path: string, options: RequestOptions): Promise<Response> {
    return this.gate.run(options.signal, () =>
      this.requestWithRetries(path, options),
    );
  }

  private async requestWithRetries(
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const attempts = options.retryTransient
      ? this.config.maxControlRetries + 1
      : 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.performRequest(path, options.init(), options.signal);
      } catch (error) {
        if (
          !isOriginalTorrentRuntimeError(error) ||
          !error.transient ||
          attempt === attempts
        ) {
          throw error;
        }
        await this.delay(this.config.retryDelayMs, options.signal);
      }
    }

    throw new OriginalTorrentRuntimeError(
      'unavailable',
      `TorrServer ${options.operation} exhausted its bounded retries.`,
      true,
    );
  }

  private async performRequest(
    path: string,
    init: RequestInit,
    externalSignal: AbortSignal | undefined,
  ): Promise<Response> {
    if (externalSignal?.aborted) throw abortedError();

    const controller = new AbortController();
    let timeout: 'connect_timeout' | 'control_timeout' | undefined;
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    const requestTimer = setTimeout(() => {
      timeout = 'control_timeout';
      controller.abort();
    }, this.config.controlRequestTimeoutMs);
    const connectTimer = setTimeout(() => {
      timeout = 'connect_timeout';
      controller.abort();
    }, this.config.controlConnectTimeoutMs);

    try {
      const response = await this.fetchImplementation(
        new URL(path, this.config.baseUrl),
        {
          ...init,
          redirect: 'manual',
          signal: controller.signal,
        },
      );
      clearTimeout(connectTimer);

      if (response.status >= 300 && response.status < 400) {
        throw new OriginalTorrentRuntimeError(
          'invalid_response',
          'TorrServer redirects are not accepted.',
          false,
          response.status,
        );
      }
      assertSuccessfulStatus(response.status);
      return await bufferBoundedResponse(
        response,
        this.config.maxResponseBytes,
        controller.signal,
      );
    } catch (error) {
      if (externalSignal?.aborted) throw abortedError();
      if (timeout !== undefined) throw timeoutError(timeout);
      if (isOriginalTorrentRuntimeError(error)) throw error;
      throw new OriginalTorrentRuntimeError(
        'unavailable',
        'TorrServer request failed before a valid response was received.',
        true,
      );
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }
}

class BoundedRequestGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueueSize: number,
  ) {}

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
    if (signal?.aborted) return Promise.reject(abortedError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    if (this.waiters.length >= this.maxQueueSize) {
      return Promise.reject(
        new OriginalTorrentRuntimeError(
          'queue_full',
          'TorrServer control request queue is full.',
          true,
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            reject(abortedError());
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
      if (released) return;
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

async function bufferBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Response> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(contentLength)) {
      throw invalidResponse('TorrServer returned an invalid content length.');
    }
    if (Number(contentLength) > maxBytes) throw responseTooLarge();
  }
  if (response.body === null) {
    return new Response(null, cloneResponseMetadata(response));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await readWithAbort(reader, signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw responseTooLarge();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, cloneResponseMetadata(response));
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    void reader.read().then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          error instanceof Error ? error : new Error('Response read failed.'),
        );
      },
    );
  });
}

function assertSuccessfulStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 401 || status === 403) {
    throw new OriginalTorrentRuntimeError(
      'unauthorized',
      'TorrServer rejected the internal runtime request.',
      false,
      status,
    );
  }
  if (status === 404) {
    throw new OriginalTorrentRuntimeError(
      'not_found',
      'TorrServer could not find the requested torrent resource.',
      false,
      status,
    );
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    throw new OriginalTorrentRuntimeError(
      'unavailable',
      'TorrServer is temporarily unavailable.',
      true,
      status,
    );
  }
  throw new OriginalTorrentRuntimeError(
    'rejected',
    'TorrServer rejected the bounded internal request.',
    false,
    status,
  );
}

function cloneResponseMetadata(response: Response): ResponseInit {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

function cancellableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortedError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function timeoutError(
  code: 'connect_timeout' | 'control_timeout',
): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError(
    code,
    code === 'connect_timeout'
      ? 'TorrServer did not respond within the control connection budget.'
      : 'TorrServer control response exceeded its total time budget.',
    true,
  );
}

function abortedError(): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError(
    'aborted',
    'TorrServer operation was cancelled.',
    false,
  );
}

function responseTooLarge(): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError(
    'response_too_large',
    'TorrServer response exceeded the configured byte limit.',
    false,
  );
}

function invalidResponse(message: string): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError('invalid_response', message, false);
}
