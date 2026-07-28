export type OriginalTorrentRuntimeErrorCode =
  | 'runtime_disabled'
  | 'aborted'
  | 'connect_timeout'
  | 'control_timeout'
  | 'metadata_timeout'
  | 'unauthorized'
  | 'not_found'
  | 'rejected'
  | 'unavailable'
  | 'incompatible_version'
  | 'invalid_response'
  | 'response_too_large'
  | 'source_invalid'
  | 'file_not_found'
  | 'queue_full';

export class OriginalTorrentRuntimeError extends Error {
  override readonly name = 'OriginalTorrentRuntimeError';

  constructor(
    readonly code: OriginalTorrentRuntimeErrorCode,
    message: string,
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isOriginalTorrentRuntimeError(
  error: unknown,
): error is OriginalTorrentRuntimeError {
  return error instanceof OriginalTorrentRuntimeError;
}
