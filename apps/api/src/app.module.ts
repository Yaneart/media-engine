import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media';
import { OriginalTorrentSessionModule } from './original-torrent-session';
import { OriginalTorrentStreamModule } from './original-torrent-stream';
import { TorrentDiscoveryModule } from './torrent-discovery';

@Module({
  imports: [
    HealthModule,
    MediaModule,
    TorrentDiscoveryModule,
    OriginalTorrentSessionModule,
    OriginalTorrentStreamModule,
  ],
})
export class AppModule {}
