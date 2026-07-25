export type TorrentPlaybackSessionErrorCode =
  | 'disabled'
  | 'candidate_not_found'
  | 'candidate_expired'
  | 'candidate_not_playable'
  | 'candidate_identity_mismatch'
  | 'invalid_file_selection'
  | 'session_not_found'
  | 'session_capacity_exceeded'
  | 'start_capacity_exceeded'
  | 'aborted';

export class TorrentPlaybackSessionError extends Error {
  override readonly name = 'TorrentPlaybackSessionError';

  constructor(
    readonly code: TorrentPlaybackSessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isTorrentPlaybackSessionError(
  error: unknown,
): error is TorrentPlaybackSessionError {
  return error instanceof TorrentPlaybackSessionError;
}
