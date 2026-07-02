import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { MediaEngineModule } from './media-engine';

@Module({
  imports: [HealthModule, MediaEngineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
