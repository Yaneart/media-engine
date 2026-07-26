import { Module } from '@nestjs/common';
import { TorrentCandidateCatalog } from './candidate-catalog';
import { readTorrentPlaybackConfig } from './config';
import { ReferencePlaybackController } from './controller';
import { readReferencePlaybackHttpConfig } from './http-config';
import { readTorrentPlaybackMediaProbeConfig } from './media-probe-config';
import {
  FfprobeTorrentMediaProbe,
  type TorrentMediaProbe,
} from './media-probe';
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
const TORRENT_MEDIA_PROBE = Symbol('TORRENT_MEDIA_PROBE');

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
      provide: TORRENT_MEDIA_PROBE,
      inject: [TORRSERVER_CLIENT_CONFIG],
      useFactory: (clientConfig: TorrServerClientConfig | undefined) => {
        const probeConfig = readTorrentPlaybackMediaProbeConfig();

        if (probeConfig === undefined || clientConfig === undefined) {
          return undefined;
        }

        if (clientConfig.username !== undefined) {
          throw new Error(
            'Local ffprobe inspection cannot be combined with TorServer Basic Auth; use the heuristic fallback or a future isolated worker.',
          );
        }

        return new FfprobeTorrentMediaProbe(probeConfig);
      },
    },
    {
      provide: TorrentPlaybackSessionService,
      inject: [TorrentCandidateCatalog, TORRSERVER_CLIENT, TORRENT_MEDIA_PROBE],
      useFactory: (
        catalog: TorrentCandidateCatalog,
        client: TorrServerClient | undefined,
        mediaProbe: TorrentMediaProbe | undefined,
      ) => {
        const config = readTorrentPlaybackConfig();
        return new TorrentPlaybackSessionService(catalog, client, config, {
          mediaProbe,
        });
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
