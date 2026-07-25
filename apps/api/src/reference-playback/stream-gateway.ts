import type { TorrentPlaybackStreamConfig } from './stream-config';
import type { TorrentPlaybackSessionService } from './session-service';
import type { TorrServerClientConfig } from './torrserver';
import { hasControlCharacters } from './torrserver/validation';
import type { TorrentPlaybackFile } from './types';

const MAX_RANGE_HEADER_LENGTH = 128;
const MAX_VALIDATOR_HEADER_LENGTH = 512;
const ETAG_PATTERN = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;

export type TorrentPlaybackStreamErrorCode =
  | 'disabled'
  | 'invalid_request'
  | 'invalid_range'
  | 'capacity_exceeded'
  | 'upstream_unavailable'
  | 'upstream_invalid_response'
  | 'upstream_timeout'
  | 'aborted';

export class TorrentPlaybackStreamError extends Error {
  override readonly name = 'TorrentPlaybackStreamError';

  constructor(
    readonly code: TorrentPlaybackStreamErrorCode,
    message: string,
    readonly fileLength?: number,
  ) {
    super(message);
  }
}

export interface TorrentPlaybackStreamRequest {
  method: 'GET' | 'HEAD';
  range?: string | string[];
  ifRange?: string | string[];
  ifNoneMatch?: string | string[];
  ifModifiedSince?: string | string[];
  signal?: AbortSignal;
}

export interface OpenTorrentPlaybackStream {
  status: 200 | 206 | 304 | 416;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  close(): void;
}

export type TorrentPlaybackStreamFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface NormalizedRange {
  start: number;
  end: number;
  header: string;
}

export class TorrentPlaybackStreamGateway {
  private activeStreams = 0;

  constructor(
    private readonly sessions: TorrentPlaybackSessionService,
    private readonly clientConfig: TorrServerClientConfig | undefined,
    private readonly streamConfig: TorrentPlaybackStreamConfig,
    private readonly fetchImplementation: TorrentPlaybackStreamFetch = fetch,
  ) {}

  async open(
    sessionId: string,
    request: TorrentPlaybackStreamRequest,
  ): Promise<OpenTorrentPlaybackStream> {
    if (this.clientConfig === undefined) {
      throw new TorrentPlaybackStreamError(
        'disabled',
        'Reference torrent playback is disabled.',
      );
    }

    const source = this.sessions.getStreamSource(sessionId);
    const normalizedRequest = normalizeRequest(request, source.file.length);

    if (this.activeStreams >= this.streamConfig.maxStreams) {
      throw new TorrentPlaybackStreamError(
        'capacity_exceeded',
        'The torrent playback stream limit is currently reached.',
      );
    }

    this.activeStreams += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.activeStreams -= 1;
      }
    };
    const controller = new AbortController();
    const detachSignals = forwardAbortSignals(
      controller,
      request.signal,
      source.signal,
    );
    let connectTimedOut = false;
    const connectTimer = setTimeout(() => {
      connectTimedOut = true;
      controller.abort(
        new TorrentPlaybackStreamError(
          'upstream_timeout',
          'TorServer did not return stream headers within the configured budget.',
        ),
      );
    }, this.clientConfig.connectTimeoutMs);
    unrefTimer(connectTimer);

    try {
      const response = await this.fetchImplementation(source.target.url, {
        method: request.method,
        headers: createUpstreamHeaders(
          this.clientConfig,
          normalizedRequest.range,
          normalizedRequest.validators,
        ),
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(connectTimer);

      if (
        response.redirected ||
        (response.status >= 300 &&
          response.status < 400 &&
          response.status !== 304)
      ) {
        await cancelBody(response.body);
        throw invalidUpstream('TorServer redirects are not accepted.');
      }

      let validated: ReturnType<typeof validateUpstreamResponse>;

      try {
        validated = validateUpstreamResponse(
          response,
          request.method,
          normalizedRequest.range,
          normalizedRequest.hasValidator,
          source.file,
        );
      } catch (error) {
        await cancelBody(response.body);
        throw error;
      }
      const body = validated.streamBody
        ? createIdleBoundedBody(
            response.body!,
            controller,
            this.streamConfig.idleTimeoutMs,
            validated.bodyLength!,
          )
        : null;

      if (!validated.streamBody) {
        await cancelBody(response.body);
      }

      return {
        status: validated.status,
        headers: validated.headers,
        body,
        close: () => {
          if (body !== null) {
            void body.cancel().catch(() => undefined);
          }

          if (!controller.signal.aborted) {
            controller.abort();
          }

          detachSignals();
          release();
        },
      };
    } catch (error) {
      clearTimeout(connectTimer);
      detachSignals();
      release();

      if (error instanceof TorrentPlaybackStreamError) {
        throw error;
      }

      if (request.signal?.aborted || source.signal.aborted) {
        throw new TorrentPlaybackStreamError(
          'aborted',
          'Torrent playback streaming was cancelled.',
        );
      }

      if (connectTimedOut) {
        throw new TorrentPlaybackStreamError(
          'upstream_timeout',
          'TorServer did not return stream headers within the configured budget.',
        );
      }

      throw new TorrentPlaybackStreamError(
        'upstream_unavailable',
        'TorServer could not open the selected media stream.',
      );
    }
  }
}

function normalizeRequest(
  request: TorrentPlaybackStreamRequest,
  fileLength: number,
): {
  range?: NormalizedRange;
  validators: Headers;
  hasValidator: boolean;
} {
  const rangeValue = readSingleHeader(
    request.range,
    'Range',
    MAX_RANGE_HEADER_LENGTH,
  );
  const range =
    rangeValue === undefined
      ? undefined
      : normalizeRange(rangeValue, fileLength);
  const ifRange = readSingleHeader(
    request.ifRange,
    'If-Range',
    MAX_VALIDATOR_HEADER_LENGTH,
  );
  const ifNoneMatch = readSingleHeader(
    request.ifNoneMatch,
    'If-None-Match',
    MAX_VALIDATOR_HEADER_LENGTH,
  );
  const ifModifiedSince = readSingleHeader(
    request.ifModifiedSince,
    'If-Modified-Since',
    MAX_VALIDATOR_HEADER_LENGTH,
  );

  if (ifRange !== undefined && range === undefined) {
    throw invalidRequest('If-Range requires a single valid Range header.');
  }

  if (
    ifRange !== undefined &&
    (!isEntityTag(ifRange) || ifRange.startsWith('W/')) &&
    !isHttpDate(ifRange)
  ) {
    throw invalidRequest('If-Range must contain one entity tag or HTTP date.');
  }

  if (
    ifNoneMatch !== undefined &&
    ifNoneMatch !== '*' &&
    !isBoundedEntityTagList(ifNoneMatch)
  ) {
    throw invalidRequest('If-None-Match contains an invalid entity-tag list.');
  }

  if (ifModifiedSince !== undefined && !isHttpDate(ifModifiedSince)) {
    throw invalidRequest('If-Modified-Since must contain an HTTP date.');
  }

  const validators = new Headers();

  if (ifRange !== undefined) validators.set('if-range', ifRange);
  if (ifNoneMatch !== undefined) validators.set('if-none-match', ifNoneMatch);
  if (ifModifiedSince !== undefined) {
    validators.set('if-modified-since', ifModifiedSince);
  }

  return {
    ...(range === undefined ? {} : { range }),
    validators,
    hasValidator:
      ifRange !== undefined ||
      ifNoneMatch !== undefined ||
      ifModifiedSince !== undefined,
  };
}

function normalizeRange(value: string, fileLength: number): NormalizedRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);

  if (match === null || (match[1] === '' && match[2] === '')) {
    throw invalidRange(fileLength);
  }

  let start: number;
  let end: number;

  if (match[1] === '') {
    const suffixLength = parseDecimal(match[2]);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw invalidRange(fileLength);
    }

    start = Math.max(0, fileLength - suffixLength);
    end = fileLength - 1;
  } else {
    start = parseDecimal(match[1]);

    if (!Number.isSafeInteger(start) || start >= fileLength) {
      throw invalidRange(fileLength);
    }

    end = match[2] === '' ? fileLength - 1 : parseDecimal(match[2]);

    if (!Number.isSafeInteger(end) || end < start) {
      throw invalidRange(fileLength);
    }

    end = Math.min(end, fileLength - 1);
  }

  return { start, end, header: `bytes=${start}-${end}` };
}

function parseDecimal(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function createUpstreamHeaders(
  config: TorrServerClientConfig,
  range: NormalizedRange | undefined,
  validators: Headers,
): Headers {
  const headers = new Headers({
    accept: 'video/*, application/octet-stream;q=0.8',
    'accept-encoding': 'identity',
  });

  if (range !== undefined) headers.set('range', range.header);
  validators.forEach((value, name) => headers.set(name, value));

  if (config.username !== undefined && config.password !== undefined) {
    headers.set(
      'authorization',
      `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`,
    );
  }

  return headers;
}

function validateUpstreamResponse(
  response: Response,
  method: 'GET' | 'HEAD',
  range: NormalizedRange | undefined,
  hasValidator: boolean,
  file: TorrentPlaybackFile,
): {
  status: 200 | 206 | 304 | 416;
  headers: Headers;
  streamBody: boolean;
  bodyLength?: number;
} {
  const contentEncoding = response.headers.get('content-encoding');

  if (
    contentEncoding !== null &&
    contentEncoding.toLowerCase() !== 'identity'
  ) {
    throw invalidUpstream(
      'TorServer returned an encoded media representation.',
    );
  }

  const output = createSafeResponseHeaders(response.headers, file);

  switch (response.status) {
    case 200: {
      if (range !== undefined || response.headers.has('content-range')) {
        throw invalidUpstream('TorServer ignored or invented a byte range.');
      }

      assertExactLength(response.headers.get('content-length'), file.length);
      return requireBody(200, method, response.body, output, file.length);
    }
    case 206: {
      if (range === undefined) {
        throw invalidUpstream(
          'TorServer returned a partial response without a range request.',
        );
      }

      const expectedContentRange = `bytes ${range.start}-${range.end}/${file.length}`;

      if (response.headers.get('content-range') !== expectedContentRange) {
        throw invalidUpstream(
          'TorServer returned an inconsistent content range.',
        );
      }

      const expectedLength = range.end - range.start + 1;
      assertExactLength(response.headers.get('content-length'), expectedLength);
      output.set('content-range', expectedContentRange);
      output.set('content-length', String(expectedLength));
      return requireBody(206, method, response.body, output, expectedLength);
    }
    case 304:
      if (!hasValidator || response.headers.has('content-range')) {
        throw invalidUpstream(
          'TorServer returned an invalid not-modified response.',
        );
      }

      output.delete('content-length');
      output.delete('content-type');
      return { status: 304, headers: output, streamBody: false };
    case 416:
      if (
        range === undefined ||
        response.headers.get('content-range') !== `bytes */${file.length}`
      ) {
        throw invalidUpstream('TorServer returned an invalid range rejection.');
      }

      output.set('content-range', `bytes */${file.length}`);
      output.delete('content-length');
      output.delete('content-type');
      return { status: 416, headers: output, streamBody: false };
    default:
      if (
        response.status === 401 ||
        response.status === 404 ||
        response.status >= 500
      ) {
        throw new TorrentPlaybackStreamError(
          'upstream_unavailable',
          'TorServer could not serve the selected media file.',
        );
      }

      throw invalidUpstream('TorServer returned an unsupported media status.');
  }
}

function requireBody(
  status: 200 | 206,
  method: 'GET' | 'HEAD',
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  bodyLength: number,
): {
  status: 200 | 206;
  headers: Headers;
  streamBody: boolean;
  bodyLength?: number;
} {
  if (method === 'GET' && body === null) {
    throw invalidUpstream(
      'TorServer returned a media response without a body.',
    );
  }

  return {
    status,
    headers,
    streamBody: method === 'GET',
    ...(method === 'GET' ? { bodyLength } : {}),
  };
}

function createSafeResponseHeaders(
  upstream: Headers,
  file: TorrentPlaybackFile,
): Headers {
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'content-type': normalizeContentType(
      upstream.get('content-type'),
      file.path,
    ),
  });
  const contentLength = upstream.get('content-length');

  if (contentLength !== null) {
    const parsed = parseDecimal(contentLength);

    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw invalidUpstream('TorServer returned an invalid content length.');
    }

    headers.set('content-length', String(parsed));
  }

  const etag = upstream.get('etag');

  if (etag !== null) {
    if (etag.length > MAX_VALIDATOR_HEADER_LENGTH || !isEntityTag(etag)) {
      throw invalidUpstream('TorServer returned an invalid entity tag.');
    }

    headers.set('etag', etag);
  }

  const lastModified = upstream.get('last-modified');

  if (lastModified !== null) {
    if (lastModified.length > 64 || !isHttpDate(lastModified)) {
      throw invalidUpstream(
        'TorServer returned an invalid last-modified date.',
      );
    }

    headers.set('last-modified', lastModified);
  }

  return headers;
}

function assertExactLength(value: string | null, expected: number): void {
  if (value === null || parseDecimal(value) !== expected) {
    throw invalidUpstream('TorServer returned an inconsistent content length.');
  }
}

function normalizeContentType(value: string | null, path: string): string {
  if (
    value !== null &&
    value.length <= 128 &&
    /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:; ?[A-Za-z0-9!#$&^_.+="-]+)*$/.test(
      value,
    )
  ) {
    return value;
  }

  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  const known: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    ts: 'video/mp2t',
  };
  return extension === undefined
    ? 'application/octet-stream'
    : (known[extension] ?? 'application/octet-stream');
}

function createIdleBoundedBody(
  body: ReadableStream<Uint8Array>,
  requestController: AbortController,
  idleTimeoutMs: number,
  expectedLength: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: TorrentPlaybackStreamError | undefined;
  let deliveredBytes = 0;
  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const resetTimer = () => {
    clearTimer();
    timer = setTimeout(() => {
      timeoutError = new TorrentPlaybackStreamError(
        'upstream_timeout',
        'TorServer media delivery exceeded the idle timeout.',
      );
      requestController.abort(timeoutError);
      void reader.cancel(timeoutError).catch(() => undefined);
    }, idleTimeoutMs);
    unrefTimer(timer);
  };

  resetTimer();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();

        if (timeoutError !== undefined) {
          clearTimer();
          controller.error(timeoutError);
          return;
        }

        if (chunk.done) {
          clearTimer();
          reader.releaseLock();

          if (deliveredBytes !== expectedLength) {
            controller.error(
              invalidUpstream(
                'TorServer ended the media body at an invalid length.',
              ),
            );
          } else {
            controller.close();
          }
          return;
        }

        deliveredBytes += chunk.value.byteLength;

        if (deliveredBytes > expectedLength) {
          const error = invalidUpstream(
            'TorServer exceeded the declared media body length.',
          );
          clearTimer();
          requestController.abort(error);
          await reader.cancel(error).catch(() => undefined);
          reader.releaseLock();
          controller.error(error);
          return;
        }

        resetTimer();
        controller.enqueue(chunk.value);
      } catch (error) {
        clearTimer();
        controller.error(timeoutError ?? error);
      }
    },
    async cancel(reason) {
      clearTimer();

      if (!requestController.signal.aborted) {
        requestController.abort(reason);
      }

      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function forwardAbortSignals(
  controller: AbortController,
  ...signals: Array<AbortSignal | undefined>
): () => void {
  const attached: Array<{ signal: AbortSignal; listener: () => void }> = [];

  for (const signal of signals) {
    if (signal === undefined) continue;

    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    const listener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    attached.push({ signal, listener });
  }

  return () => {
    for (const { signal, listener } of attached) {
      signal.removeEventListener('abort', listener);
    }
  };
}

function readSingleHeader(
  value: string | string[] | undefined,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;

  if (
    Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacters(value)
  ) {
    throw invalidRequest(`${name} contains an invalid or oversized value.`);
  }

  return value;
}

function isEntityTag(value: string): boolean {
  return ETAG_PATTERN.test(value);
}

function isBoundedEntityTagList(value: string): boolean {
  return /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"(?:\s*,\s*(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*")*$/.test(
    value,
  );
}

function isHttpDate(value: string): boolean {
  return (
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body !== null) {
    await body.cancel().catch(() => undefined);
  }
}

function invalidRequest(message: string): TorrentPlaybackStreamError {
  return new TorrentPlaybackStreamError('invalid_request', message);
}

function invalidRange(fileLength: number): TorrentPlaybackStreamError {
  return new TorrentPlaybackStreamError(
    'invalid_range',
    'Only one satisfiable byte range is supported.',
    fileLength,
  );
}

function invalidUpstream(message: string): TorrentPlaybackStreamError {
  return new TorrentPlaybackStreamError('upstream_invalid_response', message);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}
