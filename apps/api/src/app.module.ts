import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media';

@Module({
  imports: [HealthModule, MediaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
