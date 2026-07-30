import { Module } from '@nestjs/common';
import {
  OriginalTorrentObservability,
  OriginalTorrentObservabilityModule,
} from '../original-torrent-observability';
import {
  ORIGINAL_TORRENT_SESSION_CONFIG,
  OriginalTorrentSessionModule,
  type OriginalTorrentSessionConfig,
} from '../original-torrent-session';
import { OriginalTorrentSessionService } from '../original-torrent-session/session.service';
import { OriginalTorrentStreamController } from './stream.controller';
import { OriginalTorrentStreamGateway } from './stream-gateway';

@Module({
  imports: [OriginalTorrentSessionModule, OriginalTorrentObservabilityModule],
  controllers: [OriginalTorrentStreamController],
  providers: [
    {
      provide: OriginalTorrentStreamGateway,
      inject: [
        OriginalTorrentSessionService,
        ORIGINAL_TORRENT_SESSION_CONFIG,
        OriginalTorrentObservability,
      ],
      useFactory: (
        sessions: OriginalTorrentSessionService,
        config: OriginalTorrentSessionConfig,
        observability: OriginalTorrentObservability,
      ): OriginalTorrentStreamGateway =>
        new OriginalTorrentStreamGateway(sessions, {
          maxConcurrentStreams: config.maxConcurrentStreams,
          report: (event) => observability.stream(event),
        }),
    },
  ],
})
export class OriginalTorrentStreamModule {}
