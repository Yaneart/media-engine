import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media';
import { TorrentDiscoveryModule } from './torrent-discovery';

@Module({
  imports: [HealthModule, MediaModule, TorrentDiscoveryModule],
})
export class AppModule {}
