import { Module } from '@nestjs/common';
import { TorrentCandidateCatalog } from './candidate-catalog';
import { readTorrentPlaybackConfig } from './config';
import { ReferencePlaybackController } from './controller';
import { readReferencePlaybackHttpConfig } from './http-config';
import { ReferencePlaybackRuntime } from './runtime';
import { TorrentPlaybackSessionService } from './session-service';
import { readTorrentPlaybackStreamConfig } from './stream-config';
import { TorrentPlaybackStreamGateway } from './stream-gateway';
import { ReferencePlaybackTokenGuard } from './token.guard';
import {
  TorrServerClient,
  readTorrServerClientConfig,
  type TorrServerClientConfig,
} from './torrserver';

const TORRSERVER_CLIENT_CONFIG = Symbol('TORRSERVER_CLIENT_CONFIG');
const TORRSERVER_CLIENT = Symbol('TORRSERVER_CLIENT');

@Module({
  controllers: [ReferencePlaybackController],
  providers: [
    {
      provide: TORRSERVER_CLIENT_CONFIG,
      useFactory: () => readTorrServerClientConfig(),
    },
    {
      provide: TORRSERVER_CLIENT,
      inject: [TORRSERVER_CLIENT_CONFIG],
      useFactory: (config: TorrServerClientConfig | undefined) => {
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
    {
      provide: TorrentPlaybackStreamGateway,
      inject: [TorrentPlaybackSessionService, TORRSERVER_CLIENT_CONFIG],
      useFactory: (
        sessions: TorrentPlaybackSessionService,
        config: TorrServerClientConfig | undefined,
      ) =>
        new TorrentPlaybackStreamGateway(
          sessions,
          config,
          readTorrentPlaybackStreamConfig(),
        ),
    },
    ReferencePlaybackTokenGuard,
  ],
  exports: [
    TorrentCandidateCatalog,
    TorrentPlaybackSessionService,
    ReferencePlaybackRuntime,
    TorrentPlaybackStreamGateway,
  ],
})
export class ReferencePlaybackModule {}
