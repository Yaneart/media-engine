import type {
  TorrServerAddOptions,
  TorrServerRequestOptions,
  TorrServerTorrent,
} from './torrserver';

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
    magnet: string,
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
        ? this.prepare(resource, magnet, title)
        : predecessorCleanup.then(() => this.prepare(resource, magnet, title));
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
    magnet: string,
    title: string,
  ): Promise<TorrServerTorrent> {
    const torrent = await this.client.add(magnet, {
      title,
      signal: resource.controller.signal,
    });

    return torrent.files.length > 0
      ? torrent
      : this.client.waitForMetadata(resource.hash, {
          signal: resource.controller.signal,
        });
  }

  private async drop(infoHash: string): Promise<void> {
    try {
      await this.client.drop(infoHash);
    } catch {
      // Cleanup is deliberately idempotent and best-effort during stop/expiry.
    }
  }
}
