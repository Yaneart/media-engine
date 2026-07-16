import { Module } from '@nestjs/common';
import { MediaEngineModule } from '../media-engine/media-engine.module';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

@Module({
  imports: [MediaEngineModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
