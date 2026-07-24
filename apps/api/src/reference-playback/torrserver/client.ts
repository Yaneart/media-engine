import { cancellableDelay } from './abort';
import type { TorrServerClientConfig } from './config';
import { TorrServerClientError, isTorrServerClientError } from './errors';
import {
  normalizeFileId,
  normalizeInfoHash,
  normalizeMagnet,
  normalizeOptionalTitle,
  parseTorrentResponse,
} from './parsing';
import { TorrServerHttpTransport, type TorrServerFetch } from './transport';
import type {
  TorrServerAddOptions,
  TorrServerHealth,
  TorrServerPlayTarget,
  TorrServerRequestOptions,
  TorrServerTorrent,
} from './types';
import { hasControlCharacters } from './validation';

const MAX_VERSION_LENGTH = 128;

interface TorrServerClientDependencies {
  fetch?: TorrServerFetch;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class TorrServerClient {
  private readonly config: TorrServerClientConfig;
  private readonly transport: TorrServerHttpTransport;
  private readonly delay: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;

  constructor(
    config: TorrServerClientConfig,
    dependencies: TorrServerClientDependencies = {},
  ) {
    this.config = { ...config, baseUrl: new URL(config.baseUrl) };
    this.transport = new TorrServerHttpTransport(
      this.config,
      dependencies.fetch,
    );
    this.delay = dependencies.delay ?? cancellableDelay;
  }

  async health(
    options: TorrServerRequestOptions = {},
  ): Promise<TorrServerHealth> {
    const response = await this.transport.request(
      'echo',
      { method: 'GET', headers: { accept: 'text/plain' } },
      options.signal,
    );
    const version = (await this.readText(response)).trim();

    if (
      version.length === 0 ||
      version.length > MAX_VERSION_LENGTH ||
      hasControlCharacters(version)
    ) {
      throw new TorrServerClientError(
        'invalid_response',
        'TorServer returned an invalid health response.',
      );
    }

    return { version };
  }

  async add(
    magnet: string,
    options: TorrServerAddOptions = {},
  ): Promise<TorrServerTorrent> {
    const title = normalizeOptionalTitle(options.title);
    const normalizedMagnet = normalizeMagnet(magnet);
    const response = await this.torrentAction(
      {
        action: 'add',
        link: normalizedMagnet.value,
        save_to_db: false,
        ...(title === undefined ? {} : { title }),
      },
      options.signal,
    );

    return this.parseExpectedTorrent(response, normalizedMagnet.infoHash);
  }

  async get(
    hash: string,
    options: TorrServerRequestOptions = {},
  ): Promise<TorrServerTorrent> {
    const normalizedHash = normalizeInfoHash(hash);
    const response = await this.torrentAction(
      { action: 'get', hash: normalizedHash },
      options.signal,
    );

    return this.parseExpectedTorrent(response, normalizedHash);
  }

  async waitForMetadata(
    hash: string,
    options: TorrServerRequestOptions = {},
  ): Promise<TorrServerTorrent> {
    const normalizedHash = normalizeInfoHash(hash);
    const controller = new AbortController();
    let metadataTimedOut = false;
    const onAbort = () => controller.abort();

    if (options.signal?.aborted) {
      throw cancelledError();
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      metadataTimedOut = true;
      controller.abort();
    }, this.config.metadataTimeoutMs);

    try {
      while (true) {
        const torrent = await this.get(normalizedHash, {
          signal: controller.signal,
        });

        if (torrent.files.length > 0) {
          return torrent;
        }

        if (torrent.state === 4) {
          throw new TorrServerClientError(
            'unavailable',
            'TorServer closed the torrent before metadata became available.',
          );
        }

        await this.delay(this.config.metadataPollIntervalMs, controller.signal);
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw cancelledError();
      }

      if (metadataTimedOut) {
        throw new TorrServerClientError(
          'metadata_timeout',
          'TorServer metadata did not become available within the configured budget.',
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  async drop(
    hash: string,
    options: TorrServerRequestOptions = {},
  ): Promise<void> {
    await this.torrentAction(
      { action: 'drop', hash: normalizeInfoHash(hash) },
      options.signal,
    );
  }

  createPlayTarget(hash: string, fileId: number): TorrServerPlayTarget {
    const normalizedHash = normalizeInfoHash(hash);
    const normalizedFileId = normalizeFileId(fileId);

    return {
      url: new URL(
        `play/${normalizedHash}/${normalizedFileId}`,
        this.config.baseUrl,
      ),
      hash: normalizedHash,
      fileId: normalizedFileId,
    };
  }

  private torrentAction(
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    return this.transport.request(
      'torrents',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      signal,
    );
  }

  private async readText(response: Response): Promise<string> {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        await response.arrayBuffer(),
      );
    } catch (error) {
      if (isTorrServerClientError(error)) {
        throw error;
      }

      throw new TorrServerClientError(
        'invalid_response',
        'TorServer returned invalid UTF-8 data.',
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type')?.toLowerCase();

    if (
      contentType !== undefined &&
      !contentType.includes('application/json')
    ) {
      throw new TorrServerClientError(
        'invalid_response',
        'TorServer returned an unexpected response content type.',
      );
    }

    try {
      return JSON.parse(await this.readText(response)) as unknown;
    } catch (error) {
      if (isTorrServerClientError(error)) {
        throw error;
      }

      throw new TorrServerClientError(
        'invalid_response',
        'TorServer returned malformed JSON.',
      );
    }
  }

  private async parseExpectedTorrent(
    response: Response,
    expectedHash: string,
  ): Promise<TorrServerTorrent> {
    const torrent = parseTorrentResponse(
      await this.readJson(response),
      this.config,
    );

    if (torrent.hash !== expectedHash) {
      throw new TorrServerClientError(
        'invalid_response',
        'TorServer returned a different torrent identity than requested.',
      );
    }

    return torrent;
  }
}

function cancelledError(): TorrServerClientError {
  return new TorrServerClientError(
    'aborted',
    'TorServer request was cancelled.',
  );
}
