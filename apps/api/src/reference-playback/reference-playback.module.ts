import { Module } from '@nestjs/common';
import { TorrentCandidateCatalog } from './candidate-catalog';
import { readTorrentPlaybackConfig } from './config';
import { ReferencePlaybackController } from './controller';
import { readReferencePlaybackHttpConfig } from './http-config';
import { readTorrentPlaybackMediaProbeConfig } from './media-probe-config';
import { readTorrentMediaWorkerClientConfig } from './media-worker-config';
import { WorkerTorrentMediaProbe } from './media-worker-client';
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
      useFactory: (clientConfig: TorrServerClientConfig | undefined) =>
        createConfiguredTorrentMediaProbe(clientConfig),
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

export function createConfiguredTorrentMediaProbe(
  clientConfig: TorrServerClientConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): TorrentMediaProbe | undefined {
  const probeConfig = readTorrentPlaybackMediaProbeConfig(env);
  const workerConfig = readTorrentMediaWorkerClientConfig(env);

  if (probeConfig !== undefined && workerConfig !== undefined) {
    throw new Error(
      'Configure either MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL or MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH, not both.',
    );
  }

  if (clientConfig === undefined) {
    return undefined;
  }

  if (
    clientConfig.username !== undefined &&
    (probeConfig !== undefined || workerConfig !== undefined)
  ) {
    throw new Error(
      'Media inspection cannot pass TorServer Basic Auth credentials to ffprobe; leave probing disabled for this upstream.',
    );
  }

  if (workerConfig !== undefined) {
    return new WorkerTorrentMediaProbe(workerConfig);
  }

  return probeConfig === undefined
    ? undefined
    : new FfprobeTorrentMediaProbe(probeConfig);
}
