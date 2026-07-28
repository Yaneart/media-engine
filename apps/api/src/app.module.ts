import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media';
import { OriginalTorrentRuntimeModule } from './original-torrent-runtime';
import { TorrentDiscoveryModule } from './torrent-discovery';

@Module({
  imports: [
    HealthModule,
    MediaModule,
    TorrentDiscoveryModule,
    OriginalTorrentRuntimeModule,
  ],
})
export class AppModule {}
