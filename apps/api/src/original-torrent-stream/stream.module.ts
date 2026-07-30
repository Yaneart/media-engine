import { Module } from '@nestjs/common';
import {
  ORIGINAL_TORRENT_SESSION_CONFIG,
  OriginalTorrentSessionModule,
  type OriginalTorrentSessionConfig,
} from '../original-torrent-session';
import { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import { OriginalTorrentStreamController } from './stream.controller';
import { OriginalTorrentStreamGateway } from './stream-gateway';

@Module({
  imports: [OriginalTorrentSessionModule],
  controllers: [OriginalTorrentStreamController],
  providers: [
    {
      provide: OriginalTorrentStreamGateway,
      inject: [OriginalTorrentSessionService, ORIGINAL_TORRENT_SESSION_CONFIG],
      useFactory: (
        sessions: OriginalTorrentSessionService,
        config: OriginalTorrentSessionConfig,
      ): OriginalTorrentStreamGateway =>
        new OriginalTorrentStreamGateway(sessions, {
          maxConcurrentStreams: config.maxConcurrentStreams,
        }),
    },
  ],
})
export class OriginalTorrentStreamModule {}
