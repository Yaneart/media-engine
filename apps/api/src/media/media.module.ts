import { Module } from '@nestjs/common';
import { MediaEngineModule } from '../media-engine';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ProvidersController } from './providers.controller';

@Module({
  imports: [MediaEngineModule],
  controllers: [MediaController, ProvidersController],
  providers: [MediaService],
})
// EN: Groups media REST endpoints with their engine-backed services.
// RU: Группирует media REST endpoints с сервисами на базе engine.
export class MediaModule {}
