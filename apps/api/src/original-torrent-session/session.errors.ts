import {
  isOriginalTorrentRuntimeError,
  type OriginalTorrentRuntimeErrorCode,
} from '../original-torrent-runtime';
import type {
  OriginalTorrentSessionErrorCode,
  OriginalTorrentSessionFailure,
} from './session.types';

export class OriginalTorrentSessionInputError extends Error {
  override readonly name = 'OriginalTorrentSessionInputError';

  constructor(message: string) {
    super(message);
  }
}

export class OriginalTorrentSessionNotFoundError extends Error {
  override readonly name = 'OriginalTorrentSessionNotFoundError';

  constructor() {
    super('Original torrent session was not found.');
  }
}

export class OriginalTorrentSessionConflictError extends Error {
  override readonly name = 'OriginalTorrentSessionConflictError';

  constructor(
    readonly code: OriginalTorrentSessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class TorrentSourceResolutionError extends Error {
  override readonly name = 'TorrentSourceResolutionError';

  constructor(
    message: string,
    readonly transient = false,
  ) {
    super(message);
  }
}

export function mapSessionFailure(
  error: unknown,
): OriginalTorrentSessionFailure {
  if (error instanceof TorrentSourceResolutionError) {
    return {
      code: 'torrent_source_invalid',
      message: error.message,
      transient: error.transient,
    };
  }

  if (isOriginalTorrentRuntimeError(error)) {
    return mapRuntimeFailure(error.code, error.message, error.transient);
  }

  return {
    code: 'torrserver_unavailable',
    message: 'The required TorrServer runtime could not prepare the torrent.',
    transient: true,
  };
}

function mapRuntimeFailure(
  code: OriginalTorrentRuntimeErrorCode,
  message: string,
  transient: boolean,
): OriginalTorrentSessionFailure {
  if (code === 'source_invalid' || code === 'rejected') {
    return { code: 'torrent_source_invalid', message, transient };
  }
  if (code === 'metadata_timeout') {
    return { code: 'torrent_metadata_timeout', message, transient: true };
  }
  if (code === 'unavailable' || code === 'not_found') {
    return { code: 'torrent_pieces_unavailable', message, transient: true };
  }
  if (code === 'file_not_found') {
    return { code: 'torrent_file_not_found', message, transient };
  }

  return {
    code: 'torrserver_unavailable',
    message,
    transient:
      transient ||
      code === 'connect_timeout' ||
      code === 'control_timeout' ||
      code === 'queue_full',
  };
}
