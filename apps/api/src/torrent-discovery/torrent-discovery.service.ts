import { Inject, Injectable } from '@nestjs/common';
import type {
  MediaEngine,
  MediaEngineOperationOptions,
  TorrentDiscoveryResponse,
  TorrentProviderInfo,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import { rethrowMediaEngineHttpError } from '../media-engine/media-engine.errors';
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
      rethrowMediaEngineHttpError(error);
    }
  }

  getProviders(): TorrentProviderInfo[] {
    return this.mediaEngine.getTorrentProviders();
  }
}
