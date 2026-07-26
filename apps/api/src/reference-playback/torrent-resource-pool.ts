import type {
  TorrServerAddOptions,
  TorrServerPlayTarget,
  TorrServerRequestOptions,
  TorrServerTorrent,
} from './torrserver';
import { isTorrServerClientError } from './torrserver';

const MAX_PREPARE_ATTEMPTS = 2;

export interface TorrentPlaybackTorrServerClient {
  add(
    magnet: string,
    options?: TorrServerAddOptions,
  ): Promise<TorrServerTorrent>;
  waitForMetadata(
    hash: string,
    options?: TorrServerRequestOptions,
  ): Promise<TorrServerTorrent>;
  drop(hash: string, options?: TorrServerRequestOptions): Promise<void>;
  createPlayTarget(hash: string, fileId: number): TorrServerPlayTarget;
}

export interface SharedTorrentResource {
  hash: string;
  refs: number;
  controller: AbortController;
  promise: Promise<TorrServerTorrent>;
  cleanup?: Promise<void>;
}

export class TorrentResourcePool {
  private readonly resources = new Map<string, SharedTorrentResource>();

  constructor(private readonly client: TorrentPlaybackTorrServerClient) {}

  acquire(
    infoHash: string,
    handoff: string,
    title: string,
  ): SharedTorrentResource {
    const existing = this.resources.get(infoHash);

    if (existing !== undefined && existing.refs > 0) {
      existing.refs += 1;
      return existing;
    }

    const predecessorCleanup = existing?.cleanup;
    const controller = new AbortController();
    const resource = {
      hash: infoHash,
      refs: 1,
      controller,
      promise: undefined as unknown as Promise<TorrServerTorrent>,
    };
    resource.promise =
      predecessorCleanup === undefined
        ? this.prepare(resource, handoff, title)
        : predecessorCleanup.then(() => this.prepare(resource, handoff, title));
    this.resources.set(infoHash, resource);
    return resource;
  }

  async release(resource: SharedTorrentResource): Promise<void> {
    resource.refs -= 1;

    if (resource.refs > 0) {
      return;
    }

    resource.controller.abort();
    resource.cleanup = this.drop(resource.hash);
    await resource.cleanup;

    if (this.resources.get(resource.hash) === resource) {
      this.resources.delete(resource.hash);
    }
  }

  private async prepare(
    resource: SharedTorrentResource,
    handoff: string,
    title: string,
  ): Promise<TorrServerTorrent> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_PREPARE_ATTEMPTS; attempt += 1) {
      try {
        const torrent = await this.client.add(handoff, {
          title,
          expectedHash: resource.hash,
          signal: resource.controller.signal,
        });

        return torrent.files.length > 0
          ? torrent
          : await this.client.waitForMetadata(resource.hash, {
              signal: resource.controller.signal,
            });
      } catch (error) {
        lastError = error;

        if (
          attempt === MAX_PREPARE_ATTEMPTS ||
          resource.controller.signal.aborted ||
          !isRetryablePreparationError(error)
        ) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async drop(infoHash: string): Promise<void> {
    try {
      await this.client.drop(infoHash);
    } catch {
      // Cleanup is deliberately idempotent and best-effort during stop/expiry.
    }
  }
}

function isRetryablePreparationError(error: unknown): boolean {
  return (
    isTorrServerClientError(error) &&
    (error.code === 'connect_timeout' ||
      error.code === 'request_timeout' ||
      error.code === 'metadata_timeout' ||
      error.code === 'unavailable')
  );
}
