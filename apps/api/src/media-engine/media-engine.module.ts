import { Module } from '@nestjs/common';
import { MEDIA_ENGINE } from './media-engine.constants';
import { createMediaEngine } from './media-engine.config';

@Module({
  providers: [
    {
      provide: MEDIA_ENGINE,
      useFactory: createMediaEngine,
    },
  ],
  exports: [MEDIA_ENGINE],
})
export class MediaEngineModule {}
