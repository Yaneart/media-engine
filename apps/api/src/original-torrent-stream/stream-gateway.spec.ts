import { EventEmitter } from 'node:events';
import { Writable, type WritableOptions } from 'node:stream';
import type { Request, Response as ExpressResponse } from 'express';
import type { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import type { OriginalTorrentStreamAccess } from '../original-torrent-session/session.types';
import { OriginalTorrentStreamGateway } from './stream-gateway';
import { OriginalTorrentRangeInputError } from './stream-range';

const CAPABILITY = 'A'.repeat(43);
const HASH = '0123456789abcdef0123456789abcdef01234567';

describe('protected original torrent stream gateway', () => {
  it('streams a complete original response with safe headers only', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    const { sessions, gateway, fetch } = setup(
      access(bytes.byteLength),
      new Response(bytes, {
        status: 200,
        headers: {
          'content-length': String(bytes.byteLength),
          'content-type': 'video/mp4',
          etag: '"safe-etag"',
          'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
          'x-internal-secret': 'hidden',
        },
      }),
    );
    const response = new FakeResponse();

    await gateway.handle(request(), response.asExpress(), CAPABILITY, 'GET');

    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toBe('0123456789');
    expect(response.header('accept-ranges')).toBe('bytes');
    expect(response.header('content-length')).toBe('10');
    expect(response.header('content-type')).toBe('video/mp4');
    expect(response.header('etag')).toBe('"safe-etag"');
    expect(response.header('last-modified')).toBe(
      'Wed, 21 Oct 2015 07:28:00 GMT',
    );
    expect(response.header('x-internal-secret')).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      new URL(`http://torrserver:8090/play/${HASH}/1`),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: '*/*',
          'accept-encoding': 'identity',
        },
      }),
    );
    expect(sessions.failStreamCapability).not.toHaveBeenCalled();
  });

  it('forwards one canonical range and preserves exact 206 semantics', async () => {
    const { gateway, fetch } = setup(
      access(100),
      new Response(new Uint8Array(10), {
        status: 206,
        headers: {
          'content-length': '10',
          'content-range': 'bytes 90-99/100',
          'content-type': 'application/octet-stream',
        },
      }),
    );
    const response = new FakeResponse();

    await gateway.handle(
      request({ range: 'bytes=-10' }),
      response.asExpress(),
      CAPABILITY,
      'GET',
    );

    expect(response.statusCode).toBe(206);
    expect(response.body).toHaveLength(10);
    expect(response.header('content-range')).toBe('bytes 90-99/100');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ range: 'bytes=90-99' }),
    });
  });

  it('supports HEAD and forwards a bounded If-Range validator', async () => {
    const { gateway, fetch } = setup(
      access(100),
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '100',
          'content-type': 'video/webm',
          etag: '"new"',
        },
      }),
    );
    const response = new FakeResponse();

    await gateway.handle(
      request({ range: 'bytes=10-19', 'if-range': '"old"' }),
      response.asExpress(),
      CAPABILITY,
      'HEAD',
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveLength(0);
    expect(response.header('content-length')).toBe('100');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'HEAD',
      headers: expect.objectContaining({
        range: 'bytes=10-19',
        'if-range': '"old"',
      }),
    });
  });

  it('returns local 416 and rejects malformed multi-range without upstream I/O', async () => {
    const { gateway, fetch } = setup(access(100));
    const unsatisfiable = new FakeResponse();
    await gateway.handle(
      request({ range: 'bytes=100-' }),
      unsatisfiable.asExpress(),
      CAPABILITY,
      'GET',
    );
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.header('content-range')).toBe('bytes */100');
    expect(fetch).not.toHaveBeenCalled();

    await expect(
      gateway.handle(
        request({ range: 'bytes=0-1,5-6' }),
        new FakeResponse().asExpress(),
        CAPABILITY,
        'GET',
      ),
    ).rejects.toBeInstanceOf(OriginalTorrentRangeInputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries one transient pre-header response and never retries invalid headers', async () => {
    const sessions = createSessions(access(10));
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('busy', {
          status: 503,
          headers: { 'content-length': '4' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(10), {
          status: 200,
          headers: { 'content-length': '10' },
        }),
      );
    const delay = jest.fn().mockResolvedValue(undefined);
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch,
      delay,
    });
    await gateway.handle(
      request(),
      new FakeResponse().asExpress(),
      CAPABILITY,
      'GET',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);

    const invalid = setup(
      access(10),
      new Response(new Uint8Array(9), {
        status: 200,
        headers: { 'content-length': '9' },
      }),
    );
    await expect(
      invalid.gateway.handle(
        request(),
        new FakeResponse().asExpress(),
        CAPABILITY,
        'GET',
      ),
    ).rejects.toMatchObject({
      failure: { code: 'torrent_stream_failed' },
    });
    expect(invalid.fetch).toHaveBeenCalledTimes(1);
    expect(invalid.sessions.failStreamCapability).toHaveBeenCalledWith(
      CAPABILITY,
      expect.objectContaining({ code: 'torrent_stream_failed' }),
    );
  });

  it('bounds cold header waits and classifies exhausted retries as unavailable pieces', async () => {
    const accessValue = access(10, { headerTimeoutMs: 5 });
    const sessions = createSessions(accessValue);
    const fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      });
    });
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch,
      retryDelayMs: 0,
    });

    await expect(
      gateway.handle(
        request(),
        new FakeResponse().asExpress(),
        CAPABILITY,
        'GET',
      ),
    ).rejects.toMatchObject({
      failure: { code: 'torrent_pieces_unavailable', transient: true },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sessions.sessions.failStreamCapability).toHaveBeenCalledWith(
      CAPABILITY,
      expect.objectContaining({ code: 'torrent_pieces_unavailable' }),
    );
  });

  it('aborts an upstream header request on downstream disconnect without failing the session', async () => {
    const sessions = createSessions(access(10));
    const fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('downstream aborted')),
          { once: true },
        );
      });
    });
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch,
    });
    const response = new FakeResponse();
    const pending = gateway.handle(
      request(),
      response.asExpress(),
      CAPABILITY,
      'GET',
    );
    await waitUntil(() => fetch.mock.calls.length === 1);
    response.emit('close');
    await pending;

    expect(sessions.sessions.failStreamCapability).not.toHaveBeenCalled();
  });

  it('aborts an active body immediately when the owning session stops', async () => {
    const lifecycle = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const sessions = createSessions({
      ...access(2, { inactivityTimeoutMs: 1_000 }),
      signal: lifecycle.signal,
    });
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch: jest.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'content-length': '2' },
        }),
      ),
    });
    const response = new FakeResponse();
    const pending = gateway.handle(
      request(),
      response.asExpress(),
      CAPABILITY,
      'GET',
    );
    await waitUntil(() => response.flushed);
    lifecycle.abort(new Error('stopped'));
    await pending;

    expect(sessions.sessions.failStreamCapability).not.toHaveBeenCalled();
    expect(response.destroyed).toBe(true);
  });

  it('fails and invalidates a session after upstream body inactivity', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const sessions = createSessions(access(2, { inactivityTimeoutMs: 5 }));
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch: jest.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'content-length': '2' },
        }),
      ),
    });

    await gateway.handle(
      request(),
      new FakeResponse().asExpress(),
      CAPABILITY,
      'GET',
    );

    expect(sessions.sessions.failStreamCapability).toHaveBeenCalledWith(
      CAPABILITY,
      {
        code: 'torrent_pieces_unavailable',
        message: 'TorrServer stopped delivering original file bytes.',
        transient: true,
      },
    );
  });

  it('applies downstream backpressure instead of reading a complete large file', async () => {
    const chunkCount = 128;
    const chunkSize = 64 * 1024;
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(chunkSize));
        if (produced === chunkCount) controller.close();
      },
    });
    const response = new BlockingFirstWriteResponse();
    const { gateway } = setup(
      access(chunkCount * chunkSize),
      new Response(stream, {
        status: 200,
        headers: { 'content-length': String(chunkCount * chunkSize) },
      }),
    );
    const pending = gateway.handle(
      request(),
      response.asExpress(),
      CAPABILITY,
      'GET',
    );
    await response.waitForFirstWrite();
    await settle();
    expect(produced).toBeLessThan(chunkCount);
    response.release();
    await pending;
    expect(response.byteLength).toBe(chunkCount * chunkSize);
  });

  it('does not classify downstream backpressure as upstream inactivity', async () => {
    const chunkSize = 64 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(chunkSize));
        controller.enqueue(new Uint8Array(chunkSize));
        controller.close();
      },
    });
    const response = new BlockingFirstWriteResponse();
    const sessions = createSessions(
      access(chunkSize * 2, { inactivityTimeoutMs: 5 }),
    );
    const gateway = new OriginalTorrentStreamGateway(sessions.service, {
      fetch: jest.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'content-length': String(chunkSize * 2) },
        }),
      ),
    });
    const pending = gateway.handle(
      request(),
      response.asExpress(),
      CAPABILITY,
      'GET',
    );

    await response.waitForFirstWrite();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions.sessions.failStreamCapability).not.toHaveBeenCalled();
    response.release();
    await pending;
  });
});

function setup(accessValue: OriginalTorrentStreamAccess, upstream?: Response) {
  const sessions = createSessions(accessValue);
  const fetch = jest.fn();
  if (upstream !== undefined) fetch.mockResolvedValue(upstream);
  const gateway = new OriginalTorrentStreamGateway(sessions.service, {
    fetch,
    delay: jest.fn().mockResolvedValue(undefined),
  });
  return { ...sessions, gateway, fetch };
}

function createSessions(accessValue: OriginalTorrentStreamAccess) {
  const sessions = {
    resolveStreamCapability: jest.fn().mockResolvedValue(accessValue),
    failStreamCapability: jest.fn().mockResolvedValue(undefined),
  };
  return {
    sessions,
    service: sessions as unknown as OriginalTorrentSessionService,
  };
}

function access(
  length: number,
  overrides: Partial<OriginalTorrentStreamAccess['target']> = {},
): OriginalTorrentStreamAccess {
  return {
    sessionId: 'session',
    expiresAtMs: Date.now() + 60_000,
    signal: new AbortController().signal,
    target: {
      url: new URL(`http://torrserver:8090/play/${HASH}/1`),
      hash: HASH,
      fileId: 1,
      path: 'original.bin',
      length,
      headerTimeoutMs: 1_000,
      inactivityTimeoutMs: 1_000,
      ...overrides,
    },
  };
}

function request(headers: Record<string, string> = {}): Request {
  const emitter = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
  };
  emitter.headers = headers;
  return emitter as unknown as Request;
}

class FakeResponse extends Writable {
  statusCode = 200;
  readonly chunks: Buffer[] = [];
  private readonly headers = new Map<string, string>();
  flushed = false;

  constructor(options: WritableOptions = {}) {
    super(options);
  }

  get body(): Buffer {
    return Buffer.concat(this.chunks);
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  header(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  flushHeaders(): void {
    this.flushed = true;
  }

  asExpress(): ExpressResponse {
    return this as unknown as ExpressResponse;
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

class BlockingFirstWriteResponse extends FakeResponse {
  private firstWrite?: () => void;
  private firstWriteObserved?: () => void;
  private released = false;
  byteLength = 0;

  waitForFirstWrite(): Promise<void> {
    if (this.firstWrite !== undefined) return Promise.resolve();
    return new Promise((resolve) => {
      this.firstWriteObserved = resolve;
    });
  }

  release(): void {
    this.released = true;
    this.firstWrite?.();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.byteLength += chunk.byteLength;
    if (this.firstWrite === undefined && !this.released) {
      this.firstWrite = callback;
      this.firstWriteObserved?.();
      return;
    }
    callback();
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await settle();
  }
  throw new Error('Condition was not reached.');
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
