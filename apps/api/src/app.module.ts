import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media';

@Module({
  imports: [HealthModule, MediaModule],
})
export class AppModule {}
