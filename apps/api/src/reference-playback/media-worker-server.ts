import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { TorrentMediaWorkerServerConfig } from './media-worker-config';
import {
  isTorrentMediaProbeError,
  type TorrentMediaProbe,
  type TorrentMediaProbeInput,
} from './media-probe';
import { normalizeFileId, normalizeInfoHash } from './torrserver/parsing';
import type { TorrServerPlayTarget } from './torrserver';
import { hasControlCharacters } from './torrserver/validation';

const MAX_FILE_PATH_LENGTH = 1_024;
const MAX_FILE_SIZE_BYTES = 16 * 1024 ** 4;

export type TorrentMediaWorkerTargetFactory = (
  hash: string,
  fileId: number,
) => TorrServerPlayTarget;

export function createTorrentMediaWorkerServer(
  config: TorrentMediaWorkerServerConfig,
  probe: TorrentMediaProbe,
  createTarget: TorrentMediaWorkerTargetFactory,
) {
  let activeRequests = 0;
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        writeJson(response, 500, { code: 'internal_error' });
      } else {
        response.destroy();
      }
    });
  });

  server.headersTimeout = config.requestTimeoutMs;
  server.requestTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = readRequestUrl(request);

    if (
      request.method === 'GET' &&
      url?.pathname === '/health' &&
      url.search.length === 0
    ) {
      writeJson(response, 200, { status: 'ok' });
      return;
    }

    if (
      request.method !== 'POST' ||
      url?.pathname !== '/probe' ||
      url.search.length > 0
    ) {
      request.resume();
      writeJson(response, 404, { code: 'not_found' });
      return;
    }

    if (
      !/^application\/json(?:\s*;|$)/i.test(
        String(request.headers['content-type'] ?? ''),
      ) ||
      request.headers['content-encoding'] !== undefined
    ) {
      request.resume();
      writeJson(response, 415, { code: 'invalid_request' });
      return;
    }

    if (activeRequests >= config.maxConcurrency) {
      request.resume();
      writeJson(response, 503, { code: 'unavailable' });
      return;
    }

    activeRequests += 1;
    const controller = new AbortController();
    let requestTimedOut = false;
    const onAborted = () => controller.abort();
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', onAborted);
    response.once('close', onClose);
    const timeout = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, config.requestTimeoutMs);
    timeout.unref?.();

    try {
      const input = parseWorkerRequest(
        await readRequestBody(request, config.maxRequestBytes),
      );
      const target = createTarget(input.hash, input.fileId);
      const result = await probe.probe({
        target,
        file: input.file,
        signal: controller.signal,
      });

      if (!response.destroyed) {
        writeJson(response, 200, result);
      }
    } catch (error) {
      if (response.destroyed) return;

      if (requestTimedOut) {
        writeJson(response, 504, { code: 'timeout' });
        return;
      }

      if (isTorrentMediaProbeError(error)) {
        const status =
          error.code === 'timeout'
            ? 504
            : error.code === 'unavailable'
              ? 503
              : error.code === 'aborted'
                ? 499
                : 422;
        writeJson(response, status, { code: error.code });
        return;
      }

      writeJson(response, 400, { code: 'invalid_request' });
    } finally {
      clearTimeout(timeout);
      request.removeListener('aborted', onAborted);
      response.removeListener('close', onClose);
      activeRequests -= 1;
    }
  }

  return server;
}

interface WorkerProbeRequest {
  hash: string;
  fileId: number;
  file: TorrentMediaProbeInput['file'];
}

function parseWorkerRequest(value: string): WorkerProbeRequest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid JSON.');
  }

  if (!isRecord(parsed) || !isRecord(parsed.file)) {
    throw new Error('Invalid media probe request.');
  }

  if (
    typeof parsed.hash !== 'string' ||
    typeof parsed.fileId !== 'number' ||
    typeof parsed.file.id !== 'number'
  ) {
    throw new Error('Invalid media probe request.');
  }

  const hash = normalizeInfoHash(parsed.hash);
  const fileId = normalizeFileId(parsed.fileId);
  const nestedFileId = normalizeFileId(parsed.file.id);
  const path = parsed.file.path;
  const length = parsed.file.length;

  if (
    nestedFileId !== fileId ||
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > MAX_FILE_PATH_LENGTH ||
    hasControlCharacters(path) ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > MAX_FILE_SIZE_BYTES
  ) {
    throw new Error('Invalid media probe request.');
  }

  return {
    hash,
    fileId,
    file: {
      id: fileId,
      path,
      length,
      compatibility: 'unknown',
    },
  };
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const rawLength = request.headers['content-length'];

  if (
    rawLength !== undefined &&
    (!/^\d+$/.test(rawLength) || Number(rawLength) > maxBytes)
  ) {
    request.resume();
    throw new Error('Request body is too large.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;

    if (total > maxBytes) {
      throw new Error('Request body is too large.');
    }

    chunks.push(buffer);
  }

  if (total === 0) {
    throw new Error('Request body is empty.');
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Request body is not valid UTF-8.');
  }
}

function readRequestUrl(request: IncomingMessage): URL | undefined {
  try {
    return new URL(request.url ?? '', 'http://media-worker.invalid');
  } catch {
    return undefined;
  }
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
