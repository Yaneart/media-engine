import { raceWithAbort } from './abort';
import type { TorrServerClientConfig } from './config';
import { TorrServerClientError, isTorrServerClientError } from './errors';
import { TorrServerRequestGate } from './request-gate';

export type TorrServerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type TimeoutKind = 'connect_timeout' | 'request_timeout';

export class TorrServerHttpTransport {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: TorrServerFetch;
  private readonly gate: TorrServerRequestGate;
  private readonly authorization?: string;

  constructor(
    private readonly config: TorrServerClientConfig,
    fetchImplementation: TorrServerFetch = fetch,
  ) {
    this.baseUrl = new URL(config.baseUrl);
    this.fetchImplementation = fetchImplementation;
    this.gate = new TorrServerRequestGate(config.maxConcurrency);
    this.authorization = createAuthorization(config);
  }

  request(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    return this.gate.run(signal, () => this.performRequest(path, init, signal));
  }

  private async performRequest(
    path: string,
    init: RequestInit,
    externalSignal: AbortSignal | undefined,
  ): Promise<Response> {
    if (externalSignal?.aborted) {
      throw cancelledError();
    }

    const controller = new AbortController();
    let timeoutKind: TimeoutKind | undefined;
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    const requestTimeout = setTimeout(() => {
      timeoutKind = 'request_timeout';
      controller.abort();
    }, this.config.requestTimeoutMs);
    const connectTimeout = setTimeout(() => {
      timeoutKind = 'connect_timeout';
      controller.abort();
    }, this.config.connectTimeoutMs);

    try {
      const headers = new Headers(init.headers);

      if (this.authorization !== undefined) {
        headers.set('authorization', this.authorization);
      }

      const response = await raceWithAbort(
        this.fetchImplementation(new URL(path, this.baseUrl), {
          ...init,
          headers,
          redirect: 'error',
          signal: controller.signal,
        }),
        controller.signal,
      );
      clearTimeout(connectTimeout);

      if (response.redirected) {
        throw new TorrServerClientError(
          'invalid_response',
          'TorServer redirects are not accepted.',
        );
      }

      assertSuccessfulStatus(response.status);
      return await this.bufferResponse(response, controller.signal);
    } catch (error) {
      if (isTorrServerClientError(error)) {
        throw error;
      }

      if (externalSignal?.aborted) {
        throw cancelledError();
      }

      if (timeoutKind !== undefined) {
        throw timeoutError(timeoutKind);
      }

      throw new TorrServerClientError(
        'unavailable',
        'TorServer request failed before a valid response was received.',
      );
    } finally {
      clearTimeout(connectTimeout);
      clearTimeout(requestTimeout);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }

  private async bufferResponse(
    response: Response,
    signal: AbortSignal,
  ): Promise<Response> {
    const contentLength = response.headers.get('content-length');

    if (contentLength !== null) {
      if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
        throw new TorrServerClientError(
          'invalid_response',
          'TorServer returned an invalid content length.',
        );
      }

      if (Number(contentLength) > this.config.maxResponseBytes) {
        throw responseTooLargeError();
      }
    }

    if (response.body === null) {
      return new Response(null, cloneResponseMetadata(response));
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const chunk = await raceWithAbort(reader.read(), signal);

        if (chunk.done) {
          break;
        }

        total += chunk.value.byteLength;

        if (total > this.config.maxResponseBytes) {
          void reader.cancel().catch(() => undefined);
          throw responseTooLargeError();
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
}

function createAuthorization(
  config: TorrServerClientConfig,
): string | undefined {
  if (config.username === undefined || config.password === undefined) {
    return undefined;
  }

  return `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`;
}

function assertSuccessfulStatus(status: number): void {
  if (status >= 200 && status < 300) {
    return;
  }

  if (status === 401) {
    throw new TorrServerClientError(
      'unauthorized',
      'TorServer rejected its configured credentials.',
      status,
    );
  }

  if (status === 404) {
    throw new TorrServerClientError(
      'not_found',
      'TorServer could not find the requested resource.',
      status,
    );
  }

  if (status >= 500) {
    throw new TorrServerClientError(
      'unavailable',
      'TorServer is temporarily unavailable.',
      status,
    );
  }

  throw new TorrServerClientError(
    'rejected',
    'TorServer rejected the bounded request.',
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

function responseTooLargeError(): TorrServerClientError {
  return new TorrServerClientError(
    'response_too_large',
    'TorServer response exceeded the configured byte limit.',
  );
}

function cancelledError(): TorrServerClientError {
  return new TorrServerClientError(
    'aborted',
    'TorServer request was cancelled.',
  );
}

function timeoutError(kind: TimeoutKind): TorrServerClientError {
  return new TorrServerClientError(
    kind,
    kind === 'connect_timeout'
      ? 'TorServer did not respond within the configured connection budget.'
      : 'TorServer request exceeded the configured time budget.',
  );
}
