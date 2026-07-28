import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  MediaEngine,
  MediaEngineOperationOptions,
  TorrentDiscoveryResponse,
  TorrentProviderInfo,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import {
  parseTorrentDiscoveryQuery,
  type TorrentDiscoveryHttpQuery,
} from './torrent-discovery.query';

@Injectable()
// Keeps the application bridge limited to public core discovery operations.
// Ограничивает application bridge публичными discovery-операциями core.
export class TorrentDiscoveryService {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly mediaEngine: MediaEngine,
  ) {}

  async discover(
    query: TorrentDiscoveryHttpQuery,
    options?: MediaEngineOperationOptions,
  ): Promise<TorrentDiscoveryResponse> {
    try {
      return await this.mediaEngine.discoverTorrents(
        parseTorrentDiscoveryQuery(query),
        options,
      );
    } catch (error) {
      if (isMediaEngineError(error, 'INVALID_QUERY')) {
        throw new BadRequestException(error.message);
      }
      if (isMediaEngineError(error, 'PROVIDER_ERROR')) {
        throw new ServiceUnavailableException(error.message);
      }

      throw error;
    }
  }

  getProviders(): TorrentProviderInfo[] {
    return this.mediaEngine.getTorrentProviders();
  }
}

function isMediaEngineError(
  error: unknown,
  code: 'INVALID_QUERY' | 'PROVIDER_ERROR',
): error is { message: string } {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;

  return (
    value.name === 'MediaEngineError' &&
    value.code === code &&
    typeof value.message === 'string'
  );
}
