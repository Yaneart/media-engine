import { Module } from '@nestjs/common';
import {
  OriginalTorrentObservability,
  OriginalTorrentObservabilityModule,
} from '../original-torrent-observability';
import {
  readOriginalTorrentRuntimeConfig,
  type OriginalTorrentRuntimeConfig,
} from './runtime.config';
import { TorrServerAdapter } from './torrserver-adapter';

export const TORRSERVER_ADAPTER = Symbol('TORRSERVER_ADAPTER');
export const ORIGINAL_TORRENT_RUNTIME_CONFIG = Symbol(
  'ORIGINAL_TORRENT_RUNTIME_CONFIG',
);

@Module({
  imports: [OriginalTorrentObservabilityModule],
  providers: [
    {
      provide: ORIGINAL_TORRENT_RUNTIME_CONFIG,
      useFactory: readOriginalTorrentRuntimeConfig,
    },
    {
      provide: TORRSERVER_ADAPTER,
      inject: [ORIGINAL_TORRENT_RUNTIME_CONFIG, OriginalTorrentObservability],
      useFactory: (
        config: OriginalTorrentRuntimeConfig | undefined,
        observability: OriginalTorrentObservability,
      ): TorrServerAdapter | undefined =>
        config === undefined
          ? undefined
          : new TorrServerAdapter(config, {
              report: (event) => observability.runtime(event),
            }),
    },
  ],
  exports: [ORIGINAL_TORRENT_RUNTIME_CONFIG, TORRSERVER_ADAPTER],
})
// Internal app/runtime wiring only; no public package or HTTP surface.
// Только internal app/runtime wiring; без public package или HTTP surface.
export class OriginalTorrentRuntimeModule {}
