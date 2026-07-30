import type { OriginalTorrentRuntimeConfig } from './runtime.config';
import {
  isOriginalTorrentRuntimeError,
  OriginalTorrentRuntimeError,
} from './runtime.errors';
import {
  normalizeFileId,
  normalizeInfoHash,
  normalizeOriginalTorrentSource,
  hasTorrentOwnerMarker,
  parseTorrentStatus,
  parseTorrentTimestamp,
  parseUploadedTorrent,
  requireExpectedHash,
} from './runtime.parsing';
import {
  TorrServerControlTransport,
  type TorrServerFetch,
} from './runtime.transport';
import type {
  AcquiredOriginalTorrent,
  OriginalTorrentFileTarget,
  OriginalTorrentOperationOptions,
  OriginalTorrentSource,
  OriginalTorrentRuntimeLease,
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
  private readonly ownerMarker: string;

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
    this.ownerMarker = `media-engine-original:v1:${config.ownerId}`;
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

  recoverOwned(options: OriginalTorrentOperationOptions = {}): Promise<void> {
    return this.run('recover', async () => {
      await this.health(options);
      const values = await this.listRaw(options.signal);
      for (const value of values) {
        const status = parseTorrentStatus(value, this.config);
        if (hasTorrentOwnerMarker(value, this.ownerMarker)) {
          await this.dropHash(status.hash, options.signal);
        }
      }
    });
  }

  add(
    source: OriginalTorrentSource,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<AcquiredOriginalTorrent> {
    return this.run('add', async () => {
      const normalized = normalizeOriginalTorrentSource(source, this.config);

      try {
        const existing = await this.getRawStatus(
          normalized.expectedHash,
          options.signal,
        );
        return this.acquireStatus(existing.value, existing.status);
      } catch (error) {
        if (
          !isOriginalTorrentRuntimeError(error) ||
          error.code !== 'not_found'
        ) {
          throw error;
        }
      }

      try {
        if (normalized.kind === 'magnet') {
          const response = await this.torrentAction(
            {
              action: 'add',
              link: normalized.uri,
              save_to_db: false,
              data: this.ownerMarker,
              ...(normalized.title === undefined
                ? {}
                : { title: normalized.title }),
            },
            options.signal,
            false,
          );
          const value = await readJson(response);
          const status = requireExpectedHash(
            parseTorrentStatus(value, this.config),
            normalized.expectedHash,
          );
          return this.acquireStatus(value, status);
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
        form.append('data', this.ownerMarker);
        const response = await this.transport.request('torrent/upload', {
          operation: 'torrent upload',
          init: () => ({ method: 'POST', body: form }),
          signal: options.signal,
          retryTransient: false,
        });
        const value = await readJson(response);
        const status = parseUploadedTorrent(
          value,
          normalized.expectedHash,
          this.config,
        );
        return this.acquireStatus((value as unknown[])[0], status);
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

  validateLease(
    lease: OriginalTorrentRuntimeLease,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<OriginalTorrentStatus> {
    return this.run('validate', async () => {
      try {
        const current = await this.getRawStatus(lease.hash, options.signal);
        const ownership = hasTorrentOwnerMarker(current.value, this.ownerMarker)
          ? 'application'
          : 'external';
        if (
          current.status.hash !== lease.hash ||
          parseTorrentTimestamp(current.value) !== lease.timestamp ||
          ownership !== lease.ownership
        ) {
          throw restartedError();
        }
        return current.status;
      } catch (error) {
        if (
          isOriginalTorrentRuntimeError(error) &&
          error.code === 'not_found'
        ) {
          throw restartedError();
        }
        throw error;
      }
    });
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

  release(
    lease: OriginalTorrentRuntimeLease,
    options: OriginalTorrentOperationOptions = {},
  ): Promise<void> {
    return this.run('drop', async () => {
      if (lease.ownership !== 'application') return;
      let current: { value: unknown; status: OriginalTorrentStatus };
      try {
        current = await this.getRawStatus(lease.hash, options.signal);
      } catch (error) {
        if (
          isOriginalTorrentRuntimeError(error) &&
          error.code === 'not_found'
        ) {
          return;
        }
        throw error;
      }
      if (
        current.status.hash !== lease.hash ||
        parseTorrentTimestamp(current.value) !== lease.timestamp ||
        !hasTorrentOwnerMarker(current.value, this.ownerMarker)
      ) {
        return;
      }
      await this.dropHash(lease.hash, options.signal);
    });
  }

  private async getStatus(
    hash: string,
    signal: AbortSignal | undefined,
  ): Promise<OriginalTorrentStatus> {
    return (await this.getRawStatus(hash, signal)).status;
  }

  private async getRawStatus(
    hash: string,
    signal: AbortSignal | undefined,
  ): Promise<{ value: unknown; status: OriginalTorrentStatus }> {
    const normalizedHash = normalizeInfoHash(hash);
    const response = await this.torrentAction(
      { action: 'get', hash: normalizedHash },
      signal,
      true,
    );
    const value = await readJson(response);
    return {
      value,
      status: requireExpectedHash(
        parseTorrentStatus(value, this.config),
        normalizedHash,
      ),
    };
  }

  private async listRaw(signal: AbortSignal | undefined): Promise<unknown[]> {
    const response = await this.torrentAction({ action: 'list' }, signal, true);
    const value = await readJson(response);
    if (!Array.isArray(value) || value.length > this.config.maxFiles) {
      throw new OriginalTorrentRuntimeError(
        'invalid_response',
        'TorrServer returned an invalid or oversized torrent list.',
        false,
      );
    }
    return value as unknown[];
  }

  private async dropHash(
    hash: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await this.torrentAction(
      { action: 'drop', hash: normalizeInfoHash(hash) },
      signal,
      true,
    );
  }

  private acquireStatus(
    value: unknown,
    status: OriginalTorrentStatus,
  ): AcquiredOriginalTorrent {
    return {
      ...status,
      lease: {
        hash: status.hash,
        timestamp: parseTorrentTimestamp(value),
        ownership: hasTorrentOwnerMarker(value, this.ownerMarker)
          ? 'application'
          : 'external',
      },
    };
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
    const startedAt = Date.now();
    try {
      const value = await task();
      this.emit({
        operation,
        outcome: 'success',
        durationMs: elapsed(Date.now(), startedAt),
      });
      return value;
    } catch (error) {
      if (isOriginalTorrentRuntimeError(error)) {
        this.emit({
          operation,
          outcome: 'failure',
          code: error.code,
          transient: error.transient,
          durationMs: elapsed(Date.now(), startedAt),
        });
      }
      throw error;
    }
  }

  private emit(event: TorrServerAdapterEvent): void {
    try {
      this.report?.(event);
    } catch {
      // Telemetry must never change TorrServer control behavior.
    }
  }
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, now - startedAt);
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

function restartedError(): OriginalTorrentRuntimeError {
  return new OriginalTorrentRuntimeError(
    'runtime_restarted',
    'TorrServer restarted or replaced the recorded torrent ownership lease.',
    true,
  );
}
