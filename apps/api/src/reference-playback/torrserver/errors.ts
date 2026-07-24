export type TorrServerClientErrorCode =
  | 'aborted'
  | 'connect_timeout'
  | 'request_timeout'
  | 'metadata_timeout'
  | 'unauthorized'
  | 'not_found'
  | 'rejected'
  | 'unavailable'
  | 'invalid_response'
  | 'response_too_large';

export class TorrServerClientError extends Error {
  override readonly name = 'TorrServerClientError';

  constructor(
    readonly code: TorrServerClientErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isTorrServerClientError(
  error: unknown,
): error is TorrServerClientError {
  return error instanceof TorrServerClientError;
}
