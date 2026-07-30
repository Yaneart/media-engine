import { Injectable, Logger } from '@nestjs/common';
import type { TorrServerAdapterEvent } from '../original-torrent-runtime';
import type {
  OriginalTorrentSessionTelemetryEvent,
  OriginalTorrentStreamTelemetryEvent,
} from './observability.types';

type OriginalTorrentLogRecord = Record<
  string,
  string | number | boolean | undefined
>;

@Injectable()
export class OriginalTorrentObservability {
  private readonly logger = new Logger('OriginalTorrent');

  runtime(event: TorrServerAdapterEvent): void {
    this.logger.log(JSON.stringify(serializeRuntimeEvent(event)));
  }

  session(event: OriginalTorrentSessionTelemetryEvent): void {
    this.logger.log(JSON.stringify(serializeSessionEvent(event)));
  }

  stream(event: OriginalTorrentStreamTelemetryEvent): void {
    this.logger.log(JSON.stringify(serializeStreamEvent(event)));
  }
}

export function serializeRuntimeEvent(
  event: TorrServerAdapterEvent,
): OriginalTorrentLogRecord {
  return compact({
    component: 'original_torrent',
    scope: 'runtime',
    event: 'operation',
    operation: event.operation,
    outcome: event.outcome,
    code: event.code,
    transient: event.transient,
    durationMs: event.durationMs,
  });
}

export function serializeSessionEvent(
  event: OriginalTorrentSessionTelemetryEvent,
): OriginalTorrentLogRecord {
  return compact({
    component: 'original_torrent',
    scope: 'session',
    event: event.event,
    outcome: event.outcome,
    state: event.state,
    code: event.code,
    ownership: event.ownership,
    durationMs: event.durationMs,
    activeSessions: event.activeSessions,
    activeCreations: event.activeCreations,
    resources: event.resources,
    references: event.references,
    files: event.files,
  });
}

export function serializeStreamEvent(
  event: OriginalTorrentStreamTelemetryEvent,
): OriginalTorrentLogRecord {
  return compact({
    component: 'original_torrent',
    scope: 'stream',
    event: event.event,
    outcome: event.outcome,
    method: event.method,
    range: event.range,
    rangeStart: event.rangeStart,
    rangeEnd: event.rangeEnd,
    durationMs: event.durationMs,
    upstreamWaitMs: event.upstreamWaitMs,
    activeStreams: event.activeStreams,
    code: event.code,
  });
}

function compact(record: OriginalTorrentLogRecord): OriginalTorrentLogRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
