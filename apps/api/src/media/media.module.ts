import { Module } from '@nestjs/common';
import { MediaEngineModule } from '../media-engine';
import { MediaController } from './media.controller';
import { MediaSearchService } from './media-search.service';

@Module({
  imports: [MediaEngineModule],
  controllers: [MediaController],
  providers: [MediaSearchService],
})
// EN: Groups media REST endpoints with their engine-backed services.
// RU: Группирует media REST endpoints с сервисами на базе engine.
export class MediaModule {}
