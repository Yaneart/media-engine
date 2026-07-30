import type { OriginalTorrentSessionErrorCode } from '../original-torrent-session/session.types';

export type OriginalTorrentTelemetryOutcome =
  'success' | 'failure' | 'cancelled';

export interface OriginalTorrentSessionTelemetryEvent {
  event:
    | 'recovery'
    | 'session_created'
    | 'session_state'
    | 'metadata_ready'
    | 'resource_reference'
    | 'cleanup';
  outcome?: OriginalTorrentTelemetryOutcome;
  state?:
    | 'adding'
    | 'waiting_metadata'
    | 'selection_required'
    | 'ready'
    | 'failed'
    | 'stopped'
    | 'expired';
  code?: OriginalTorrentSessionErrorCode;
  ownership?: 'application' | 'external';
  durationMs?: number;
  activeSessions: number;
  activeCreations: number;
  resources: number;
  references: number;
  files?: number;
}

export interface OriginalTorrentStreamTelemetryEvent {
  event: 'started' | 'upstream_headers' | 'first_byte' | 'finished';
  outcome?: OriginalTorrentTelemetryOutcome;
  method: 'GET' | 'HEAD';
  range: 'full' | 'partial';
  rangeStart?: number;
  rangeEnd?: number;
  durationMs?: number;
  upstreamWaitMs?: number;
  activeStreams: number;
  code?: OriginalTorrentSessionErrorCode | 'torrent_stream_capacity_exceeded';
}
