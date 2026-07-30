import { Module } from '@nestjs/common';
import type { MediaEngine } from '@media-engine/core';
import {
  OriginalTorrentObservability,
  OriginalTorrentObservabilityModule,
} from '../original-torrent-observability';
import { MEDIA_ENGINE, MediaEngineModule } from '../media-engine';
import {
  ORIGINAL_TORRENT_RUNTIME_CONFIG,
  OriginalTorrentRuntimeModule,
  TORRSERVER_ADAPTER,
  type OriginalTorrentRuntimeConfig,
  type TorrServerAdapter,
} from '../original-torrent-runtime';
import {
  readOriginalTorrentSessionConfig,
  type OriginalTorrentSessionConfig,
} from './session.config';
import { OriginalTorrentSessionController } from './session.controller';
import {
  ORIGINAL_TORRENT_SESSION_AUTH_CONFIG,
  OriginalTorrentSessionTokenGuard,
  readOriginalTorrentSessionAuthConfig,
} from './session-auth';
import { OriginalTorrentSessionService } from './session.service';
import type { OriginalTorrentSourceResolver } from './session.types';
import { ServerTorrentSourceResolver } from './torrent-source-resolver';

export const ORIGINAL_TORRENT_SESSION_CONFIG = Symbol(
  'ORIGINAL_TORRENT_SESSION_CONFIG',
);
export const ORIGINAL_TORRENT_SOURCE_RESOLVER = Symbol(
  'ORIGINAL_TORRENT_SOURCE_RESOLVER',
);

@Module({
  imports: [
    MediaEngineModule,
    OriginalTorrentRuntimeModule,
    OriginalTorrentObservabilityModule,
  ],
  controllers: [OriginalTorrentSessionController],
  providers: [
    {
      provide: ORIGINAL_TORRENT_SESSION_AUTH_CONFIG,
      useFactory: readOriginalTorrentSessionAuthConfig,
    },
    OriginalTorrentSessionTokenGuard,
    {
      provide: ORIGINAL_TORRENT_SESSION_CONFIG,
      inject: [ORIGINAL_TORRENT_RUNTIME_CONFIG],
      useFactory: (
        runtimeConfig: OriginalTorrentRuntimeConfig | undefined,
      ): OriginalTorrentSessionConfig =>
        readOriginalTorrentSessionConfig(
          runtimeConfig?.maxTorrentBytes ?? 4 * 1024 * 1024,
        ),
    },
    {
      provide: ORIGINAL_TORRENT_SOURCE_RESOLVER,
      inject: [MEDIA_ENGINE, ORIGINAL_TORRENT_SESSION_CONFIG],
      useFactory: (
        mediaEngine: MediaEngine,
        config: OriginalTorrentSessionConfig,
      ): OriginalTorrentSourceResolver =>
        new ServerTorrentSourceResolver(mediaEngine, config),
    },
    {
      provide: OriginalTorrentSessionService,
      inject: [
        TORRSERVER_ADAPTER,
        ORIGINAL_TORRENT_SOURCE_RESOLVER,
        ORIGINAL_TORRENT_SESSION_CONFIG,
        OriginalTorrentObservability,
      ],
      useFactory: (
        adapter: TorrServerAdapter | undefined,
        resolver: OriginalTorrentSourceResolver,
        config: OriginalTorrentSessionConfig,
        observability: OriginalTorrentObservability,
      ): OriginalTorrentSessionService =>
        new OriginalTorrentSessionService(adapter, resolver, config, {
          report: (event) => observability.session(event),
        }),
    },
  ],
  exports: [OriginalTorrentSessionService, ORIGINAL_TORRENT_SESSION_CONFIG],
})
export class OriginalTorrentSessionModule {}
