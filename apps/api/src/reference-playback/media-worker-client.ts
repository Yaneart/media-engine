import type { TorrentMediaWorkerClientConfig } from './media-worker-config';
import {
  TorrentMediaRemuxError,
  containerContentType,
  type TorrentMediaRemuxInput,
  type TorrentMediaRemuxResult,
  type TorrentMediaRemuxer,
} from './media-remux';
import {
  TorrentMediaProbeError,
  parseTorrentMediaProbeResult,
  type TorrentMediaProbe,
  type TorrentMediaProbeInput,
  type TorrentMediaProbeResult,
} from './media-probe';

export type TorrentMediaWorkerFetch = typeof fetch;
const MAX_REMUX_RESULT_BYTES = 16 * 1024 ** 3;

export class WorkerTorrentMediaProbe implements TorrentMediaProbe {
  private readonly endpoint: URL;

  constructor(
    private readonly config: TorrentMediaWorkerClientConfig,
    private readonly request: TorrentMediaWorkerFetch = fetch,
  ) {
    this.endpoint = new URL('probe', config.baseUrl);
  }

  async probe(input: TorrentMediaProbeInput): Promise<TorrentMediaProbeResult> {
    if (input.signal?.aborted) {
      throw probeError('aborted');
    }

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.request(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          hash: input.target.hash,
          fileId: input.target.fileId,
          file: {
            id: input.file.id,
            path: input.file.path,
            length: input.file.length,
          },
        }),
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 504) {
        throw probeError('timeout');
      }

      if (response.status === 503) {
        throw probeError('unavailable');
      }

      if (response.status !== 200 || !isJson(response.headers)) {
        throw probeError('invalid_response');
      }

      const text = await readBoundedBody(
        response,
        this.config.maxResponseBytes,
        controller.signal,
        () => probeError('invalid_response'),
      );

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw probeError('invalid_response');
      }

      return parseTorrentMediaProbeResult(parsed);
    } catch (error) {
      if (error instanceof TorrentMediaProbeError) {
        throw error;
      }

      if (input.signal?.aborted) {
        throw probeError('aborted');
      }

      if (timedOut) {
        throw probeError('timeout');
      }

      throw probeError('unavailable');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }
}

export class WorkerTorrentMediaRemuxer implements TorrentMediaRemuxer {
  private readonly endpoint: URL;

  constructor(
    private readonly config: TorrentMediaWorkerClientConfig,
    private readonly request: TorrentMediaWorkerFetch = fetch,
  ) {
    this.endpoint = new URL('remux', config.baseUrl);
  }

  async remux(input: TorrentMediaRemuxInput): Promise<TorrentMediaRemuxResult> {
    if (input.signal?.aborted) throw remuxError('aborted');

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.remuxTimeoutMs);
    timeout.unref?.();

    try {
      const response = await this.request(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          hash: input.target.hash,
          fileId: input.target.fileId,
          file: {
            id: input.file.id,
            path: input.file.path,
            length: input.file.length,
          },
          container: input.container,
        }),
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 504) throw remuxError('timeout');
      if (response.status === 507) throw remuxError('output_limit');
      if (response.status === 503) throw remuxError('unavailable');
      if (response.status !== 201 || !isJson(response.headers)) {
        throw remuxError('invalid_response');
      }

      const text = await readBoundedBody(
        response,
        this.config.maxResponseBytes,
        controller.signal,
        () => remuxError('invalid_response'),
      );
      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        throw remuxError('invalid_response');
      }

      return parseRemuxResult(parsed, this.config.baseUrl);
    } catch (error) {
      if (error instanceof TorrentMediaRemuxError) throw error;
      if (input.signal?.aborted) throw remuxError('aborted');
      if (timedOut) throw remuxError('timeout');
      throw remuxError('unavailable');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async release(
    result: TorrentMediaRemuxResult,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.cleanupTimeoutMs,
    );
    timeout.unref?.();

    try {
      const response = await this.request(
        new URL(`remux/${encodeURIComponent(result.id)}`, this.config.baseUrl),
        {
          method: 'DELETE',
          redirect: 'manual',
          signal: controller.signal,
        },
      );

      if (response.status !== 204 && response.status !== 404) {
        throw remuxError('unavailable');
      }
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof TorrentMediaRemuxError) throw error;
      throw remuxError(options.signal?.aborted ? 'aborted' : 'unavailable');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  invalidError: () => Error,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');

  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    await response.body?.cancel();
    throw invalidError();
  }

  if (response.body === null) {
    throw invalidError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;

      if (total > maxBytes) {
        throw invalidError();
      }

      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidError();
  }
}

function parseRemuxResult(
  value: unknown,
  baseUrl: URL,
): TorrentMediaRemuxResult {
  if (!isRecord(value)) throw remuxError('invalid_response');

  const { id, length, container } = value;

  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(id) ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > MAX_REMUX_RESULT_BYTES ||
    (container !== 'mp4' && container !== 'webm' && container !== 'ogg')
  ) {
    throw remuxError('invalid_response');
  }

  return {
    id,
    target: {
      url: new URL(`remux/${encodeURIComponent(id)}`, baseUrl),
    },
    length,
    container,
    contentType: containerContentType(container),
  };
}

function isJson(headers: Headers): boolean {
  return /^application\/json(?:\s*;|$)/i.test(
    headers.get('content-type') ?? '',
  );
}

function probeError(
  code: 'aborted' | 'timeout' | 'unavailable' | 'invalid_response',
): TorrentMediaProbeError {
  const messages = {
    aborted: 'Media inspection was cancelled.',
    timeout: 'Media inspection exceeded its configured time budget.',
    unavailable: 'The configured media inspection worker is unavailable.',
    invalid_response: 'Media inspection did not return valid bounded metadata.',
  } as const;
  return new TorrentMediaProbeError(code, messages[code]);
}

function remuxError(
  code:
    'aborted' | 'timeout' | 'unavailable' | 'output_limit' | 'invalid_response',
): TorrentMediaRemuxError {
  const messages = {
    aborted: 'Media remux was cancelled.',
    timeout: 'Media remux exceeded its configured time budget.',
    unavailable: 'The configured media remux worker is unavailable.',
    output_limit: 'Media remux exceeded its configured output limit.',
    invalid_response: 'Media remux did not return a valid bounded result.',
  } as const;
  return new TorrentMediaRemuxError(
    code === 'invalid_response' ? 'failed' : code,
    messages[code],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
