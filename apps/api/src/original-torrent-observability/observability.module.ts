import { Module } from '@nestjs/common';
import { OriginalTorrentObservability } from './observability.service';

@Module({
  providers: [OriginalTorrentObservability],
  exports: [OriginalTorrentObservability],
})
export class OriginalTorrentObservabilityModule {}
