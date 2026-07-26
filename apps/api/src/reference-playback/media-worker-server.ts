import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { TorrentMediaWorkerServerConfig } from './media-worker-config';
import {
  containerExtension,
  isTorrentMediaRemuxError,
  type TorrentMediaRemuxContainer,
  type TorrentMediaRemuxExecutor,
} from './media-remux';
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
const REMUX_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type TorrentMediaWorkerTargetFactory = (
  hash: string,
  fileId: number,
) => TorrServerPlayTarget;

export function createTorrentMediaWorkerServer(
  config: TorrentMediaWorkerServerConfig,
  probe: TorrentMediaProbe,
  createTarget: TorrentMediaWorkerTargetFactory,
  remux?: {
    executor: TorrentMediaRemuxExecutor;
    outputDirectory: string;
    maxOutputBytes: number;
  },
) {
  let activeProbeRequests = 0;
  let activeRemuxRequests = 0;
  let storedBytes = 0;
  let reservedBytes = 0;
  const outputs = new Map<string, StoredRemuxOutput>();
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
  server.once('close', () => {
    for (const output of outputs.values()) {
      clearTimeout(output.expiryTimer);
      void unlink(output.path).catch(() => undefined);
    }
    outputs.clear();
    storedBytes = 0;
    reservedBytes = 0;
  });

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

    const outputId = readRemuxOutputId(url);

    if (outputId !== undefined && request.method === 'DELETE') {
      request.resume();
      await deleteOutput(outputId);
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }

    if (
      outputId !== undefined &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      await serveOutput(request, response, outputId);
      return;
    }

    if (
      request.method !== 'POST' ||
      (url?.pathname !== '/probe' && url?.pathname !== '/remux') ||
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

    const isRemux = url.pathname === '/remux';

    if (
      (isRemux &&
        (remux === undefined ||
          activeRemuxRequests >= config.maxRemuxConcurrency)) ||
      (!isRemux && activeProbeRequests >= config.maxConcurrency)
    ) {
      request.resume();
      writeJson(response, 503, { code: 'unavailable' });
      return;
    }

    if (isRemux) activeRemuxRequests += 1;
    else activeProbeRequests += 1;
    const controller = new AbortController();
    let requestTimedOut = false;
    const onAborted = () => controller.abort();
    const onClose = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', onAborted);
    response.once('close', onClose);
    const timeoutMs = isRemux ? config.outputTtlMs : config.requestTimeoutMs;
    const timeout = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, timeoutMs);
    timeout.unref?.();

    try {
      const input = parseWorkerRequest(
        await readRequestBody(request, config.maxRequestBytes),
        isRemux,
      );
      const target = createTarget(input.hash, input.fileId);

      if (isRemux) {
        await handleRemux(input, target, controller.signal, response);
        return;
      }

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

      if (isTorrentMediaRemuxError(error)) {
        const status =
          error.code === 'timeout'
            ? 504
            : error.code === 'unavailable'
              ? 503
              : error.code === 'output_limit'
                ? 507
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
      if (isRemux) activeRemuxRequests -= 1;
      else activeProbeRequests -= 1;
    }
  }

  async function handleRemux(
    input: WorkerProbeRequest,
    target: TorrServerPlayTarget,
    signal: AbortSignal,
    response: ServerResponse,
  ): Promise<void> {
    if (remux === undefined || input.container === undefined) {
      throw new Error('Media remux is disabled.');
    }

    if (
      input.file.length > remux.maxOutputBytes ||
      storedBytes + reservedBytes + remux.maxOutputBytes > config.maxStoredBytes
    ) {
      writeJson(response, 507, { code: 'output_limit' });
      return;
    }

    reservedBytes += remux.maxOutputBytes;

    try {
      await mkdir(remux.outputDirectory, { recursive: true });
      const id = createRemuxId(outputs);
      const outputPath = join(
        remux.outputDirectory,
        `${id}.${containerExtension(input.container)}`,
      );
      const result = await remux.executor.remux({
        target,
        file: input.file,
        container: input.container,
        outputPath,
        signal,
      });

      if (
        result.path !== outputPath ||
        result.container !== input.container ||
        result.length <= 0 ||
        result.length >= remux.maxOutputBytes
      ) {
        await unlink(outputPath).catch(() => undefined);
        throw new Error('Media remux returned an invalid output.');
      }

      if (
        signal.aborted ||
        storedBytes + result.length > config.maxStoredBytes
      ) {
        await unlink(result.path).catch(() => undefined);
        if (signal.aborted) return;
        writeJson(response, 507, { code: 'output_limit' });
        return;
      }

      const expiryTimer = setTimeout(() => {
        void deleteOutput(id);
      }, config.outputTtlMs);
      expiryTimer.unref?.();
      const output: StoredRemuxOutput = {
        id,
        path: result.path,
        length: result.length,
        container: result.container,
        contentType: result.contentType,
        expiresAtMs: Date.now() + config.outputTtlMs,
        expiryTimer,
      };
      outputs.set(id, output);
      storedBytes += output.length;
      writeJson(response, 201, {
        id: output.id,
        length: output.length,
        container: output.container,
      });
    } finally {
      reservedBytes -= remux.maxOutputBytes;
    }
  }

  async function serveOutput(
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> {
    const output = outputs.get(id);

    if (output === undefined || output.expiresAtMs <= Date.now()) {
      if (output !== undefined) await deleteOutput(id);
      request.resume();
      writeJson(response, 404, { code: 'not_found' });
      return;
    }

    let range: OutputRange | undefined;

    try {
      range = parseOutputRange(request.headers.range, output.length);
    } catch {
      request.resume();
      response.writeHead(416, {
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
        'content-range': `bytes */${output.length}`,
        'x-content-type-options': 'nosniff',
      });
      response.end();
      return;
    }
    const status = range === undefined ? 200 : 206;
    const start = range?.start ?? 0;
    const end = range?.end ?? output.length - 1;
    const length = end - start + 1;
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-length': String(length),
      'content-type': output.contentType,
      etag: `"${output.id}"`,
      'x-content-type-options': 'nosniff',
    };

    if (range !== undefined) {
      headers['content-range'] = `bytes ${start}-${end}/${output.length}`;
    }

    response.writeHead(status, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    await pipeline(createReadStream(output.path, { start, end }), response);
  }

  async function deleteOutput(id: string): Promise<void> {
    const output = outputs.get(id);
    if (output === undefined) return;
    outputs.delete(id);
    clearTimeout(output.expiryTimer);
    storedBytes -= output.length;
    await unlink(output.path).catch(() => undefined);
  }

  return server;
}

interface StoredRemuxOutput {
  id: string;
  path: string;
  length: number;
  container: TorrentMediaRemuxContainer;
  contentType: string;
  expiresAtMs: number;
  expiryTimer: ReturnType<typeof setTimeout>;
}

interface WorkerProbeRequest {
  hash: string;
  fileId: number;
  file: TorrentMediaProbeInput['file'];
  container?: TorrentMediaRemuxContainer;
}

function parseWorkerRequest(
  value: string,
  expectContainer: boolean,
): WorkerProbeRequest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid JSON.');
  }

  if (!isRecord(parsed) || !isRecord(parsed.file)) {
    throw new Error('Invalid media probe request.');
  }

  const requestKeys = new Set(
    expectContainer
      ? ['hash', 'fileId', 'file', 'container']
      : ['hash', 'fileId', 'file'],
  );

  if (
    Object.keys(parsed).some((key) => !requestKeys.has(key)) ||
    Object.keys(parsed.file).some(
      (key) => key !== 'id' && key !== 'path' && key !== 'length',
    )
  ) {
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
  const container = parsed.container;

  if (
    nestedFileId !== fileId ||
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > MAX_FILE_PATH_LENGTH ||
    hasControlCharacters(path) ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > MAX_FILE_SIZE_BYTES ||
    (expectContainer &&
      container !== 'mp4' &&
      container !== 'webm' &&
      container !== 'ogg') ||
    (!expectContainer && container !== undefined)
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
    ...(expectContainer
      ? { container: container as TorrentMediaRemuxContainer }
      : {}),
  };
}

interface OutputRange {
  start: number;
  end: number;
}

function readRemuxOutputId(url: URL | undefined): string | undefined {
  if (url === undefined || url.search.length > 0) return undefined;
  const match = /^\/remux\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  return match?.[1];
}

function parseOutputRange(
  value: string | undefined,
  length: number,
): OutputRange | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);

  if (match === null || (match[1] === '' && match[2] === '')) {
    throw new Error('Invalid range.');
  }

  let start: number;
  let end: number;

  if (match[1] === '') {
    const suffix = parseDecimal(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new Error('Invalid range.');
    }
    start = Math.max(0, length - suffix);
    end = length - 1;
  } else {
    start = parseDecimal(match[1]);
    if (!Number.isSafeInteger(start) || start >= length) {
      throw new Error('Invalid range.');
    }
    end = match[2] === '' ? length - 1 : parseDecimal(match[2]);
    if (!Number.isSafeInteger(end) || end < start) {
      throw new Error('Invalid range.');
    }
    end = Math.min(end, length - 1);
  }

  return { start, end };
}

function parseDecimal(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function createRemuxId(outputs: Map<string, StoredRemuxOutput>): string {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = randomBytes(32).toString('base64url');
    if (REMUX_ID_PATTERN.test(id) && !outputs.has(id)) return id;
  }
  throw new Error('Could not create a unique remux output ID.');
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
