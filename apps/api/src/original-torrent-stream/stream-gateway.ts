import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import type { OriginalTorrentStreamTelemetryEvent } from '../original-torrent-observability';
import { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import type {
  OriginalTorrentSessionFailure,
  OriginalTorrentStreamAccess,
} from '../original-torrent-session/session.types';
import {
  OriginalTorrentClientDisconnectedError,
  OriginalTorrentInactivityError,
  OriginalTorrentStreamCapacityError,
  OriginalTorrentUpstreamStreamError,
} from './stream.errors';
import {
  parseOriginalTorrentIfRange,
  parseOriginalTorrentRange,
  type OriginalTorrentByteRange,
} from './stream-range';
import {
  invalidUpstream,
  validateUpstreamResponse,
  writeResponseHeaders,
  writeUnsatisfiable,
} from './stream-response';

export type OriginalTorrentStreamFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<globalThis.Response>;

interface OriginalTorrentStreamGatewayDependencies {
  fetch?: OriginalTorrentStreamFetch;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  maxHeaderRetries?: number;
  retryDelayMs?: number;
  maxConcurrentStreams?: number;
  now?: () => number;
  report?: (event: OriginalTorrentStreamTelemetryEvent) => void;
}

interface UpstreamResult {
  response: globalThis.Response;
  controller: AbortController;
  unlink: () => void;
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class OriginalTorrentStreamGateway {
  private readonly fetch: OriginalTorrentStreamFetch;
  private readonly delay: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly maxHeaderRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxConcurrentStreams: number;
  private readonly now: () => number;
  private readonly report?: (
    event: OriginalTorrentStreamTelemetryEvent,
  ) => void;
  private activeStreams = 0;

  constructor(
    private readonly sessions: OriginalTorrentSessionService,
    dependencies: OriginalTorrentStreamGatewayDependencies = {},
  ) {
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.delay = dependencies.delay ?? abortableDelay;
    this.maxHeaderRetries = dependencies.maxHeaderRetries ?? 1;
    this.retryDelayMs = dependencies.retryDelayMs ?? 100;
    this.maxConcurrentStreams = dependencies.maxConcurrentStreams ?? 8;
    this.now = dependencies.now ?? Date.now;
    this.report = dependencies.report;
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
      !Number.isSafeInteger(this.maxConcurrentStreams) ||
      this.maxConcurrentStreams < 1 ||
      this.maxConcurrentStreams > 256
    ) {
      throw new Error(
        'Original torrent stream concurrency must be between 1 and 256.',
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

    const rangeTelemetry = telemetryRange(range);
    const startedAt = this.now();
    let releaseStream: () => void;
    try {
      releaseStream = this.acquireStream();
    } catch (error) {
      this.emit({
        event: 'finished',
        outcome: 'failure',
        method,
        ...rangeTelemetry,
        durationMs: elapsed(this.now(), startedAt),
        activeStreams: this.activeStreams,
        code: 'torrent_stream_capacity_exceeded',
      });
      throw error;
    }
    this.emit({
      event: 'started',
      method,
      ...rangeTelemetry,
      activeStreams: this.activeStreams,
    });

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
    let outcome: 'success' | 'failure' | 'cancelled' = 'success';
    let failureCode: OriginalTorrentSessionFailure['code'] | undefined;
    let upstreamWaitMs: number | undefined;
    try {
      const upstreamStartedAt = this.now();
      upstream = await this.openWithRetry(
        access,
        method,
        range,
        ifRange,
        downstream.signal,
      );
      upstreamWaitMs = elapsed(this.now(), upstreamStartedAt);
      this.emit({
        event: 'upstream_headers',
        outcome: 'success',
        method,
        ...rangeTelemetry,
        upstreamWaitMs,
        activeStreams: this.activeStreams,
      });
      const headers = validateUpstreamResponse(
        upstream.response,
        access.target.length,
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
        () => {
          this.emit({
            event: 'first_byte',
            outcome: 'success',
            method,
            ...rangeTelemetry,
            durationMs: elapsed(this.now(), startedAt),
            ...(upstreamWaitMs === undefined ? {} : { upstreamWaitMs }),
            activeStreams: this.activeStreams,
          });
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
        if (lifecycleEnded) {
          outcome = 'cancelled';
          return;
        }
        if (downstreamDisconnected && !upstreamBodyFailure) {
          outcome = 'cancelled';
          return;
        }
        const failure: OriginalTorrentSessionFailure = {
          code: 'torrent_pieces_unavailable',
          message:
            error instanceof OriginalTorrentInactivityError
              ? error.message
              : 'The selected torrent stopped delivering original file bytes.',
          transient: true,
        };
        outcome = 'failure';
        failureCode = failure.code;
        await this.sessions.failStreamCapability(capability, failure);
        response.destroy(
          error instanceof Error ? error : new Error(failure.message),
        );
      }
    } catch (error) {
      if (lifecycleEnded) {
        outcome = 'cancelled';
        return;
      }
      if (error instanceof OriginalTorrentUpstreamStreamError) {
        outcome = 'failure';
        failureCode = error.failure.code;
        await upstream?.response.body?.cancel().catch(() => undefined);
        await this.sessions.failStreamCapability(capability, error.failure);
        throw error;
      }
      if (
        downstreamDisconnected ||
        error instanceof OriginalTorrentClientDisconnectedError
      ) {
        outcome = 'cancelled';
        return;
      }
      outcome = 'failure';
      failureCode = 'torrent_stream_failed';
      throw error;
    } finally {
      releaseStream();
      this.emit({
        event: 'finished',
        outcome,
        method,
        ...rangeTelemetry,
        durationMs: elapsed(this.now(), startedAt),
        ...(upstreamWaitMs === undefined ? {} : { upstreamWaitMs }),
        activeStreams: this.activeStreams,
        ...(failureCode === undefined ? {} : { code: failureCode }),
      });
      upstream?.unlink();
      request.removeListener('aborted', disconnect);
      response.removeListener('close', disconnect);
      access.signal.removeEventListener('abort', onLifecycleEnd);
    }
  }

  private acquireStream(): () => void {
    if (this.activeStreams >= this.maxConcurrentStreams) {
      throw new OriginalTorrentStreamCapacityError();
    }
    this.activeStreams += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeStreams -= 1;
    };
  }

  private emit(event: OriginalTorrentStreamTelemetryEvent): void {
    try {
      this.report?.(event);
    } catch {
      // Telemetry must never change stream behavior.
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
  private firstByteReported = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly expectedBytes: number,
    private readonly isDownstreamBackpressured: () => boolean,
    private readonly onTimeout: () => void,
    private readonly onFirstByte: () => void,
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
    if (!this.firstByteReported && chunk.byteLength > 0) {
      this.firstByteReported = true;
      this.onFirstByte();
    }
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

function telemetryRange(
  range: Exclude<OriginalTorrentByteRange, { kind: 'unsatisfiable' }>,
): Pick<
  OriginalTorrentStreamTelemetryEvent,
  'range' | 'rangeStart' | 'rangeEnd'
> {
  return range.kind === 'full'
    ? { range: 'full' }
    : { range: 'partial', rangeStart: range.start, rangeEnd: range.end };
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, now - startedAt);
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
