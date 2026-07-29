import type { OriginalTorrentSessionFailure } from '../original-torrent-session/session.types';

export class OriginalTorrentUpstreamStreamError extends Error {
  override readonly name = 'OriginalTorrentUpstreamStreamError';

  constructor(
    readonly failure: OriginalTorrentSessionFailure,
    readonly retryableBeforeHeaders: boolean,
  ) {
    super(failure.message);
  }
}

export class OriginalTorrentClientDisconnectedError extends Error {
  override readonly name = 'OriginalTorrentClientDisconnectedError';

  constructor() {
    super('The downstream HTTP client disconnected.');
  }
}

export class OriginalTorrentInactivityError extends Error {
  override readonly name = 'OriginalTorrentInactivityError';

  constructor() {
    super('TorrServer stopped delivering original file bytes.');
  }
}
