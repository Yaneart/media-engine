import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import type {
  OriginalTorrentSessionFailure,
  OriginalTorrentStreamAccess,
} from '../original-torrent-session/session.types';
import {
  OriginalTorrentClientDisconnectedError,
  OriginalTorrentInactivityError,
  OriginalTorrentUpstreamStreamError,
} from './stream.errors';
import {
  isOriginalTorrentHttpDate,
  parseOriginalTorrentIfRange,
  parseOriginalTorrentRange,
  type OriginalTorrentByteRange,
} from './stream-range';

export type OriginalTorrentStreamFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<globalThis.Response>;

interface OriginalTorrentStreamGatewayDependencies {
  fetch?: OriginalTorrentStreamFetch;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  maxHeaderRetries?: number;
  retryDelayMs?: number;
}

interface UpstreamResult {
  response: globalThis.Response;
  controller: AbortController;
  unlink: () => void;
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_SAFE_HEADER_LENGTH = 512;

export class OriginalTorrentStreamGateway {
  private readonly fetch: OriginalTorrentStreamFetch;
  private readonly delay: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly maxHeaderRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly sessions: OriginalTorrentSessionService,
    dependencies: OriginalTorrentStreamGatewayDependencies = {},
  ) {
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.delay = dependencies.delay ?? abortableDelay;
    this.maxHeaderRetries = dependencies.maxHeaderRetries ?? 1;
    this.retryDelayMs = dependencies.retryDelayMs ?? 100;
    if (
      !Number.isSafeInteger(this.maxHeaderRetries) ||
      this.maxHeaderRetries < 0 ||
      this.maxHeaderRetries > 2
    ) {
      throw new Error(
        'Original torrent stream header retries must be between 0 and 2.',
      );
    }
    if (
      !Number.isSafeInteger(this.retryDelayMs) ||
      this.retryDelayMs < 0 ||
      this.retryDelayMs > 5_000
    ) {
      throw new Error(
        'Original torrent stream retry delay must be between 0 and 5000 ms.',
      );
    }
  }

  async handle(
    request: Request,
    response: Response,
    capability: string,
    method: 'GET' | 'HEAD',
  ): Promise<void> {
    const access = await this.sessions.resolveStreamCapability(capability);
    const range = parseOriginalTorrentRange(
      request.headers.range,
      access.target.length,
    );
    const ifRange =
      range.kind === 'partial'
        ? parseOriginalTorrentIfRange(request.headers['if-range'])
        : undefined;

    if (range.kind === 'unsatisfiable') {
      writeUnsatisfiable(response, access.target.length);
      return;
    }

    const downstream = new AbortController();
    let downstreamDisconnected = false;
    let lifecycleEnded = false;
    const disconnect = () => {
      if (response.writableEnded || downstream.signal.aborted) return;
      downstreamDisconnected = true;
      downstream.abort(new OriginalTorrentClientDisconnectedError());
    };
    request.once('aborted', disconnect);
    response.once('close', disconnect);
    const onLifecycleEnd = () => {
      lifecycleEnded = true;
      if (!downstream.signal.aborted) {
        downstream.abort(new OriginalTorrentClientDisconnectedError());
      }
      if (!response.writableEnded) {
        response.destroy(new Error('Original torrent session ended.'));
      }
    };
    access.signal.addEventListener('abort', onLifecycleEnd, { once: true });
    if (access.signal.aborted) onLifecycleEnd();

    let upstream: UpstreamResult | undefined;
    try {
      upstream = await this.openWithRetry(
        access,
        method,
        range,
        ifRange,
        downstream.signal,
      );
      const headers = validateUpstreamResponse(
        upstream.response,
        access,
        range,
        ifRange !== undefined,
      );
      if (
        method === 'GET' &&
        headers.contentLength > 0 &&
        upstream.response.body === null
      ) {
        throw invalidUpstream(
          'TorrServer returned no body for a non-empty original file response.',
        );
      }
      writeResponseHeaders(response, upstream.response.status, headers);

      if (method === 'HEAD' || headers.contentLength === 0) {
        await upstream.response.body?.cancel();
        response.end();
        return;
      }
      if (upstream.response.body === null) return;

      response.flushHeaders();
      let upstreamBodyFailure = false;
      const guard = new InactivityGuard(
        access.target.inactivityTimeoutMs,
        headers.contentLength,
        () => response.writableNeedDrain,
        () => {
          upstreamBodyFailure = true;
          upstream?.controller.abort(new OriginalTorrentInactivityError());
        },
      );
      const source = Readable.fromWeb(
        upstream.response.body as unknown as NodeReadableStream<Uint8Array>,
      );
      source.once('error', () => {
        if (!downstreamDisconnected) upstreamBodyFailure = true;
      });
      try {
        await pipeline(source, guard, response);
      } catch (error) {
        if (lifecycleEnded) return;
        if (downstreamDisconnected && !upstreamBodyFailure) return;
        const failure: OriginalTorrentSessionFailure = {
          code: 'torrent_pieces_unavailable',
          message:
            error instanceof OriginalTorrentInactivityError
              ? error.message
              : 'The selected torrent stopped delivering original file bytes.',
          transient: true,
        };
        await this.sessions.failStreamCapability(capability, failure);
        response.destroy(
          error instanceof Error ? error : new Error(failure.message),
        );
      }
    } catch (error) {
      if (lifecycleEnded) return;
      if (error instanceof OriginalTorrentUpstreamStreamError) {
        await upstream?.response.body?.cancel().catch(() => undefined);
        await this.sessions.failStreamCapability(capability, error.failure);
        throw error;
      }
      if (
        downstreamDisconnected ||
        error instanceof OriginalTorrentClientDisconnectedError
      ) {
        return;
      }
      throw error;
    } finally {
      upstream?.unlink();
      request.removeListener('aborted', disconnect);
      response.removeListener('close', disconnect);
      access.signal.removeEventListener('abort', onLifecycleEnd);
    }
  }

  private async openWithRetry(
    access: OriginalTorrentStreamAccess,
    method: 'GET' | 'HEAD',
    range: Exclude<OriginalTorrentByteRange, { kind: 'unsatisfiable' }>,
    ifRange: string | undefined,
    downstreamSignal: AbortSignal,
  ): Promise<UpstreamResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxHeaderRetries; attempt += 1) {
      try {
        return await this.openOnce(
          access,
          method,
          range,
          ifRange,
          downstreamSignal,
        );
      } catch (error) {
        if (error instanceof OriginalTorrentClientDisconnectedError)
          throw error;
        lastError = error;
        if (
          !(error instanceof OriginalTorrentUpstreamStreamError) ||
          !error.retryableBeforeHeaders ||
          attempt === this.maxHeaderRetries
        ) {
          throw error;
        }
        await this.delay(this.retryDelayMs, downstreamSignal);
      }
    }
    throw lastError;
  }

  private async openOnce(
    access: OriginalTorrentStreamAccess,
    method: 'GET' | 'HEAD',
    range: Exclude<OriginalTorrentByteRange, { kind: 'unsatisfiable' }>,
    ifRange: string | undefined,
    downstreamSignal: AbortSignal,
  ): Promise<UpstreamResult> {
    if (downstreamSignal.aborted) {
      throw new OriginalTorrentClientDisconnectedError();
    }
    const controller = new AbortController();
    const onDownstreamAbort = () => controller.abort(downstreamSignal.reason);
    downstreamSignal.addEventListener('abort', onDownstreamAbort, {
      once: true,
    });
    const unlink = () =>
      downstreamSignal.removeEventListener('abort', onDownstreamAbort);
    let headerTimedOut = false;
    const timer = setTimeout(() => {
      headerTimedOut = true;
      controller.abort();
    }, access.target.headerTimeoutMs);

    try {
      const headers: Record<string, string> = {
        accept: '*/*',
        'accept-encoding': 'identity',
      };
      if (range.kind === 'partial') headers.range = range.header;
      if (ifRange !== undefined) headers['if-range'] = ifRange;
      const response = await this.fetch(access.target.url, {
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (TRANSIENT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        unlink();
        throw unavailableUpstream(
          `TorrServer returned transient HTTP ${response.status} before stream headers were committed.`,
        );
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        unlink();
        throw invalidUpstream(
          'TorrServer original-file redirects are forbidden.',
        );
      }
      return { response, controller, unlink };
    } catch (error) {
      unlink();
      if (downstreamSignal.aborted) {
        throw new OriginalTorrentClientDisconnectedError();
      }
      if (error instanceof OriginalTorrentUpstreamStreamError) throw error;
      throw unavailableUpstream(
        headerTimedOut
          ? 'TorrServer did not return original-file headers within the configured cold-stream deadline.'
          : 'TorrServer could not open the selected original file.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

interface SafeUpstreamHeaders {
  contentLength: number;
  contentRange?: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
}

function validateUpstreamResponse(
  response: globalThis.Response,
  access: OriginalTorrentStreamAccess,
  range: Exclude<OriginalTorrentByteRange, { kind: 'unsatisfiable' }>,
  hasIfRange: boolean,
): SafeUpstreamHeaders {
  const expectedStatus = range.kind === 'partial' ? 206 : 200;
  const acceptedFullForIfRange =
    range.kind === 'partial' && hasIfRange && response.status === 200;
  if (response.status !== expectedStatus && !acceptedFullForIfRange) {
    throw invalidUpstream(
      `TorrServer returned unexpected HTTP ${response.status} for the original-file request.`,
    );
  }
  const contentEncoding = response.headers.get('content-encoding');
  if (
    contentEncoding !== null &&
    contentEncoding.toLowerCase() !== 'identity'
  ) {
    throw invalidUpstream(
      'TorrServer returned an encoded original-file response.',
    );
  }
  const contentLength = readExactLength(response.headers.get('content-length'));
  const expectedLength =
    response.status === 206 && range.kind === 'partial'
      ? range.length
      : access.target.length;
  if (contentLength !== expectedLength) {
    throw invalidUpstream(
      'TorrServer Content-Length does not match the recorded original file range.',
    );
  }

  let contentRange: string | undefined;
  if (response.status === 206 && range.kind === 'partial') {
    contentRange = response.headers.get('content-range') ?? undefined;
    const expected = `bytes ${range.start}-${range.end}/${access.target.length}`;
    if (contentRange !== expected) {
      throw invalidUpstream(
        'TorrServer Content-Range does not match the requested original file range.',
      );
    }
  } else if (response.headers.has('content-range')) {
    throw invalidUpstream(
      'TorrServer returned Content-Range for a full response.',
    );
  }

  return {
    contentLength,
    ...(contentRange === undefined ? {} : { contentRange }),
    contentType: readContentType(response.headers.get('content-type')),
    ...readValidators(response.headers),
  };
}

function writeResponseHeaders(
  response: Response,
  status: number,
  headers: SafeUpstreamHeaders,
): void {
  response.statusCode = status;
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Length', String(headers.contentLength));
  response.setHeader('Content-Type', headers.contentType);
  response.setHeader('Cache-Control', 'private, no-store');
  if (headers.contentRange !== undefined) {
    response.setHeader('Content-Range', headers.contentRange);
  }
  if (headers.etag !== undefined) response.setHeader('ETag', headers.etag);
  if (headers.lastModified !== undefined) {
    response.setHeader('Last-Modified', headers.lastModified);
  }
}

function writeUnsatisfiable(response: Response, fileLength: number): void {
  response.status(416);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Range', `bytes */${fileLength}`);
  response.setHeader('Content-Length', '0');
  response.setHeader('Cache-Control', 'private, no-store');
  response.end();
}

function readExactLength(value: string | null): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw invalidUpstream('TorrServer returned an invalid Content-Length.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidUpstream('TorrServer returned an invalid Content-Length.');
  }
  return parsed;
}

function readContentType(value: string | null): string {
  if (
    value === null ||
    value.length === 0 ||
    value.length > 200 ||
    hasControlCharacters(value) ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+-]+|"[^"]*"))*$/u.test(
      value,
    )
  ) {
    return 'application/octet-stream';
  }
  return value;
}

function readValidators(
  headers: Headers,
): Pick<SafeUpstreamHeaders, 'etag' | 'lastModified'> {
  const etag = readSafeHeader(headers.get('etag'));
  const lastModified = readSafeHeader(headers.get('last-modified'));
  return {
    ...(etag !== undefined && /^(?:W\/)?"[\x20-\x21\x23-\x7e]*"$/u.test(etag)
      ? { etag }
      : {}),
    ...(lastModified !== undefined && isOriginalTorrentHttpDate(lastModified)
      ? { lastModified }
      : {}),
  };
}

function readSafeHeader(value: string | null): string | undefined {
  return value !== null &&
    value.length > 0 &&
    value.length <= MAX_SAFE_HEADER_LENGTH &&
    !hasControlCharacters(value)
    ? value
    : undefined;
}

function invalidUpstream(message: string): OriginalTorrentUpstreamStreamError {
  return new OriginalTorrentUpstreamStreamError(
    { code: 'torrent_stream_failed', message, transient: false },
    false,
  );
}

function unavailableUpstream(
  message: string,
): OriginalTorrentUpstreamStreamError {
  return new OriginalTorrentUpstreamStreamError(
    { code: 'torrent_pieces_unavailable', message, transient: true },
    true,
  );
}

class InactivityGuard extends Transform {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private receivedBytes = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly expectedBytes: number,
    private readonly isDownstreamBackpressured: () => boolean,
    private readonly onTimeout: () => void,
  ) {
    super();
    this.resetTimer();
    this.on('pause', () => this.clearTimer());
    this.on('resume', () => this.resetTimer());
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.receivedBytes += chunk.byteLength;
    if (this.receivedBytes >= this.expectedBytes) {
      this.clearTimer();
    } else {
      this.resetTimer();
    }
    callback(null, chunk);
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    this.clearTimer();
    callback(error);
  }

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.isDownstreamBackpressured()) {
        this.resetTimer();
        return;
      }
      const error = new OriginalTorrentInactivityError();
      this.onTimeout();
      this.destroy(error);
    }, this.timeoutMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new OriginalTorrentClientDisconnectedError());
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OriginalTorrentClientDisconnectedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
