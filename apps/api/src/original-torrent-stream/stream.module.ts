import { Module } from '@nestjs/common';
import { OriginalTorrentSessionModule } from '../original-torrent-session';
import { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import { OriginalTorrentStreamController } from './stream.controller';
import { OriginalTorrentStreamGateway } from './stream-gateway';

@Module({
  imports: [OriginalTorrentSessionModule],
  controllers: [OriginalTorrentStreamController],
  providers: [
    {
      provide: OriginalTorrentStreamGateway,
      inject: [OriginalTorrentSessionService],
      useFactory: (
        sessions: OriginalTorrentSessionService,
      ): OriginalTorrentStreamGateway =>
        new OriginalTorrentStreamGateway(sessions),
    },
  ],
})
export class OriginalTorrentStreamModule {}
