import type { Request } from 'express';

const REFERENCE_PLAYBACK_PREFIX = '/reference/torrent-playback';
const SESSION_PATH_PATTERN =
  /^\/reference\/torrent-playback\/sessions\/[A-Za-z0-9_-]{1,256}$/;

export function isReferencePlaybackRequest(request: Request): boolean {
  const path = normalizePath(request.path);

  if (
    request.method === 'GET' &&
    path === `${REFERENCE_PLAYBACK_PREFIX}/health`
  ) {
    return true;
  }

  if (
    request.method === 'POST' &&
    path === `${REFERENCE_PLAYBACK_PREFIX}/sessions`
  ) {
    return true;
  }

  return (
    (request.method === 'GET' || request.method === 'DELETE') &&
    SESSION_PATH_PATTERN.test(path)
  );
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
