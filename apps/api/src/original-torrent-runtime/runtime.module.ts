import { Module } from '@nestjs/common';
import { readOriginalTorrentRuntimeConfig } from './runtime.config';
import { TorrServerAdapter } from './torrserver-adapter';

export const TORRSERVER_ADAPTER = Symbol('TORRSERVER_ADAPTER');

@Module({
  providers: [
    {
      provide: TORRSERVER_ADAPTER,
      useFactory: (): TorrServerAdapter | undefined => {
        const config = readOriginalTorrentRuntimeConfig();
        return config === undefined ? undefined : new TorrServerAdapter(config);
      },
    },
  ],
  exports: [TORRSERVER_ADAPTER],
})
// Internal app/runtime wiring only; no public package or HTTP surface.
// Только internal app/runtime wiring; без public package или HTTP surface.
export class OriginalTorrentRuntimeModule {}
