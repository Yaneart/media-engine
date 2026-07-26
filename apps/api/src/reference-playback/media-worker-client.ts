import type { TorrentMediaWorkerClientConfig } from './media-worker-config';
import {
  TorrentMediaProbeError,
  parseTorrentMediaProbeResult,
  type TorrentMediaProbe,
  type TorrentMediaProbeInput,
  type TorrentMediaProbeResult,
} from './media-probe';

export type TorrentMediaWorkerFetch = typeof fetch;

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

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');

  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    await response.body?.cancel();
    throw probeError('invalid_response');
  }

  if (response.body === null) {
    throw probeError('invalid_response');
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
        throw probeError('invalid_response');
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
    throw probeError('invalid_response');
  }
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
