import { Module } from '@nestjs/common';
import { TorrentCandidateCatalog } from './candidate-catalog';
import { readTorrentPlaybackConfig } from './config';
import { TorrentPlaybackSessionService } from './session-service';
import { TorrServerClient, readTorrServerClientConfig } from './torrserver';

@Module({
  providers: [
    {
      provide: TorrentCandidateCatalog,
      useFactory: () =>
        new TorrentCandidateCatalog(readTorrentPlaybackConfig()),
    },
    {
      provide: TorrentPlaybackSessionService,
      inject: [TorrentCandidateCatalog],
      useFactory: (catalog: TorrentCandidateCatalog) => {
        const config = readTorrentPlaybackConfig();
        const clientConfig = readTorrServerClientConfig();
        const client =
          clientConfig === undefined
            ? undefined
            : new TorrServerClient(clientConfig);
        return new TorrentPlaybackSessionService(catalog, client, config);
      },
    },
  ],
  exports: [TorrentCandidateCatalog, TorrentPlaybackSessionService],
})
export class ReferencePlaybackModule {}
