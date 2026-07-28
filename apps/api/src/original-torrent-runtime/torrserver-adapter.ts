import type { OriginalTorrentRuntimeConfig } from './runtime.config';
import {
  isOriginalTorrentRuntimeError,
  OriginalTorrentRuntimeError,
} from './runtime.errors';
import {
  normalizeFileId,
  normalizeInfoHash,
  normalizeOriginalTorrentSource,
  parseTorrentStatus,
  parseUploadedTorrent,
  requireExpectedHash,
} from './runtime.parsing';
import {
  TorrServerControlTransport,
  type TorrServerFetch,
} from './runtime.transport';
import type {
  OriginalTorrentFileTarget,
  OriginalTorrentOperationOptions,
  OriginalTorrentSource,
  OriginalTorrentStatus,
  TorrServerAdapterEvent,
  TorrServerRuntimeHealth,
} from './runtime.types';

interface TorrServerAdapterDependencies {
  fetch?: TorrServerFetch;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  report?: (event: TorrServerAdapterEvent) => void;
}

export class TorrServerAdapter {
  private readonly transport: TorrServerControlTransport;
  private readonly delay: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly report?: (event: TorrServerAdapterEvent) => void;

  constructor(
    private readonly config: OriginalTorrentRuntimeConfig,
    dependencies: TorrServerAdapterDependencies = {},
  ) {
    this.transport = new TorrServerControlTransport(
      config,
      dependencies.fetch,
      dependencies.delay,
    );
    this.delay = dependencies.delay ?? cancellableDelay;
    this.report = dependencies.report;
  }

  health(
    options: OriginalTorrentOperationOptions = {},
  ): Promise<TorrServerRuntimeHealth> {
    return this.run('health', async () => {
      const response = await this.transport.request('echo', {
        operation: 'health',
        init: () => ({ method: 'GET', headers: { accept: 'text/plain' } }),
        signal: options.signal,
        retryTransient: true,
      });
      const version = (await readText(response)).trim();

      if (version !== this.config.expectedVersion) {
        throw new OriginalTorrentRuntimeError(
          'incompatible_version',
          'TorrServer runtime version does not match the pinned application contract.',
          false,
        );
      }
      return { version, compatible: true };
    });
  }

  add(
    source: OriginalTorrentSource,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<OriginalTorrentStatus> {
    return this.run('add', async () => {
      const normalized = normalizeOriginalTorrentSource(source, this.config);

      try {
        if (normalized.kind === 'magnet') {
          const response = await this.torrentAction(
            {
              action: 'add',
              link: normalized.uri,
              save_to_db: false,
              ...(normalized.title === undefined
                ? {}
                : { title: normalized.title }),
            },
            options.signal,
            false,
          );
          return requireExpectedHash(
            parseTorrentStatus(await readJson(response), this.config),
            normalized.expectedHash,
          );
        }

        const form = new FormData();
        const torrentBuffer = new ArrayBuffer(normalized.bytes.byteLength);
        new Uint8Array(torrentBuffer).set(normalized.bytes);
        form.append(
          'file',
          new Blob([torrentBuffer], { type: 'application/x-bittorrent' }),
          'source.torrent',
        );
        if (normalized.title !== undefined) {
          form.append('title', normalized.title);
        }
        const response = await this.transport.request('torrent/upload', {
          operation: 'torrent upload',
          init: () => ({ method: 'POST', body: form }),
          signal: options.signal,
          retryTransient: false,
        });
        return parseUploadedTorrent(
          await readJson(response),
          normalized.expectedHash,
          this.config,
        );
      } catch (error) {
        if (isOriginalTorrentRuntimeError(error) && error.code === 'rejected') {
          throw new OriginalTorrentRuntimeError(
            'source_invalid',
            'TorrServer rejected the resolved torrent source.',
            false,
            error.status,
          );
        }
        throw error;
      }
    });
  }

  get(
    hash: string,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<OriginalTorrentStatus> {
    return this.run('get', () => this.getStatus(hash, options.signal));
  }

  waitForMetadata(
    hash: string,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<OriginalTorrentStatus> {
    return this.run('metadata', async () => {
      const normalizedHash = normalizeInfoHash(hash);
      if (options.signal?.aborted) throw abortedError();

      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.config.metadataTimeoutMs);

      try {
        while (true) {
          const torrent = await this.getStatus(
            normalizedHash,
            controller.signal,
          );
          if (torrent.files.length > 0) return torrent;
          if (torrent.state === 4) {
            throw new OriginalTorrentRuntimeError(
              'unavailable',
              'TorrServer closed the torrent before metadata became available.',
              true,
            );
          }
          await this.delay(
            this.config.metadataPollIntervalMs,
            controller.signal,
          );
        }
      } catch (error) {
        if (options.signal?.aborted) throw abortedError();
        if (timedOut) {
          throw new OriginalTorrentRuntimeError(
            'metadata_timeout',
            'Torrent metadata did not become available within the configured budget.',
            true,
          );
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    });
  }

  resolveFileTarget(
    hash: string,
    fileId: number,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<OriginalTorrentFileTarget> {
    return this.run('target', async () => {
      const normalizedHash = normalizeInfoHash(hash);
      const normalizedFileId = normalizeFileId(fileId);
      const torrent = await this.getStatus(normalizedHash, options.signal);
      const file = torrent.files.find((entry) => entry.id === normalizedFileId);

      if (file === undefined) {
        throw new OriginalTorrentRuntimeError(
          'file_not_found',
          'The requested file ID is not present in the recorded torrent metadata.',
          false,
        );
      }

      return {
        url: new URL(
          `play/${normalizedHash}/${normalizedFileId}`,
          this.config.baseUrl,
        ),
        hash: normalizedHash,
        fileId: normalizedFileId,
        path: file.path,
        length: file.length,
        headerTimeoutMs: this.config.coldStreamHeaderTimeoutMs,
        inactivityTimeoutMs: this.config.coldStreamInactivityTimeoutMs,
      };
    });
  }

  drop(
    hash: string,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<void> {
    return this.run('drop', async () => {
      await this.torrentAction(
        { action: 'drop', hash: normalizeInfoHash(hash) },
        options.signal,
        true,
      );
    });
  }

  private async getStatus(
    hash: string,
    signal: AbortSignal | undefined,
  ): Promise<OriginalTorrentStatus> {
    const normalizedHash = normalizeInfoHash(hash);
    const response = await this.torrentAction(
      { action: 'get', hash: normalizedHash },
      signal,
      true,
    );
    return requireExpectedHash(
      parseTorrentStatus(await readJson(response), this.config),
      normalizedHash,
    );
  }

  private torrentAction(
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    retryTransient: boolean,
  ): Promise<Response> {
    const json = JSON.stringify(body);
    return this.transport.request('torrents', {
      operation: typeof body.action === 'string' ? body.action : 'control',
      init: () => ({
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: json,
      }),
      signal,
      retryTransient,
    });
  }

  private async run<T>(
    operation: TorrServerAdapterEvent['operation'],
    task: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await task();
      this.report?.({ operation, outcome: 'success' });
      return value;
    } catch (error) {
      if (isOriginalTorrentRuntimeError(error)) {
        this.report?.({
          operation,
          outcome: 'failure',
          code: error.code,
          transient: error.transient,
        });
      }
      throw error;
    }
  }
}

async function readText(response: Response): Promise<string> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      await response.arrayBuffer(),
    );
  } catch {
    throw new OriginalTorrentRuntimeError(
      'invalid_response',
      'TorrServer returned invalid UTF-8 data.',
      false,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase();
  if (contentType !== undefined && !contentType.includes('application/json')) {
    throw new OriginalTorrentRuntimeError(
      'invalid_response',
      'TorrServer returned an unexpected content type.',
      false,
    );
  }
  try {
    return JSON.parse(await readText(response)) as unknown;
  } catch (error) {
    if (isOriginalTorrentRuntimeError(error)) throw error;
    throw new OriginalTorrentRuntimeError(
      'invalid_response',
      'TorrServer returned malformed JSON.',
      false,
    );
  }
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

function abortedError(): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError(
    'aborted',
    'TorrServer operation was cancelled.',
    false,
  );
}
