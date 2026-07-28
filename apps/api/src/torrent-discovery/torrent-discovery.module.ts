import { Module } from '@nestjs/common';
import { MediaEngineModule } from '../media-engine';
import {
  TorrentDiscoveryController,
  TorrentProviderController,
} from './torrent-discovery.controller';
import { TorrentDiscoveryService } from './torrent-discovery.service';

@Module({
  imports: [MediaEngineModule],
  controllers: [TorrentDiscoveryController, TorrentProviderController],
  providers: [TorrentDiscoveryService],
})
export class TorrentDiscoveryModule {}
