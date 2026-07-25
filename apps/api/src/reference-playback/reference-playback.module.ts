import { Module } from '@nestjs/common';
import { TorrentCandidateCatalog } from './candidate-catalog';
import { readTorrentPlaybackConfig } from './config';
import { ReferencePlaybackController } from './controller';
import { readReferencePlaybackHttpConfig } from './http-config';
import { ReferencePlaybackRuntime } from './runtime';
import { TorrentPlaybackSessionService } from './session-service';
import { ReferencePlaybackTokenGuard } from './token.guard';
import { TorrServerClient, readTorrServerClientConfig } from './torrserver';

const TORRSERVER_CLIENT = Symbol('TORRSERVER_CLIENT');

@Module({
  controllers: [ReferencePlaybackController],
  providers: [
    {
      provide: TORRSERVER_CLIENT,
      useFactory: () => {
        const config = readTorrServerClientConfig();
        return config === undefined ? undefined : new TorrServerClient(config);
      },
    },
    {
      provide: ReferencePlaybackRuntime,
      inject: [TORRSERVER_CLIENT],
      useFactory: (client: TorrServerClient | undefined) =>
        new ReferencePlaybackRuntime(
          client,
          readReferencePlaybackHttpConfig(client !== undefined),
        ),
    },
    {
      provide: TorrentCandidateCatalog,
      useFactory: () =>
        new TorrentCandidateCatalog(readTorrentPlaybackConfig()),
    },
    {
      provide: TorrentPlaybackSessionService,
      inject: [TorrentCandidateCatalog, TORRSERVER_CLIENT],
      useFactory: (
        catalog: TorrentCandidateCatalog,
        client: TorrServerClient | undefined,
      ) => {
        const config = readTorrentPlaybackConfig();
        return new TorrentPlaybackSessionService(catalog, client, config);
      },
    },
    ReferencePlaybackTokenGuard,
  ],
  exports: [
    TorrentCandidateCatalog,
    TorrentPlaybackSessionService,
    ReferencePlaybackRuntime,
  ],
})
export class ReferencePlaybackModule {}
