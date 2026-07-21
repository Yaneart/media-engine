import type { NextFunction, Request, RequestHandler, Response } from 'express';

const RATE_LIMITED_PATHS = new Set([
  '/media/search',
  '/media/details',
  '/media/availability',
]);
const MAX_TRACKED_CLIENTS = 10_000;

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
}

// Apply one bounded process-local budget across the expensive public media routes.
// Применяет единый ограниченный process-local budget к дорогим public media routes.
export function createRateLimitMiddleware(
  options: RateLimitOptions,
): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();
  const now = options.now ?? Date.now;
  let nextCleanupAt = 0;

  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      options.maxRequests === 0 ||
      request.method !== 'GET' ||
      !RATE_LIMITED_PATHS.has(normalizePath(request.path))
    ) {
      next();
      return;
    }

    const currentTime = now();

    if (currentTime >= nextCleanupAt) {
      removeExpiredEntries(entries, currentTime, options.windowMs);
      nextCleanupAt = currentTime + options.windowMs;
    }

    const key = request.socket.remoteAddress ?? 'unknown';
    let entry = entries.get(key);

    if (
      entry === undefined ||
      currentTime - entry.windowStartedAt >= options.windowMs
    ) {
      ensureCapacity(entries);
      entry = { count: 0, windowStartedAt: currentTime };
      entries.set(key, entry);
    }

    entry.count += 1;
    const resetAt = entry.windowStartedAt + options.windowMs;
    const remaining = Math.max(0, options.maxRequests - entry.count);

    response.setHeader('RateLimit-Limit', String(options.maxRequests));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1_000)));

    if (entry.count <= options.maxRequests) {
      next();
      return;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt - currentTime) / 1_000),
    );
    response.setHeader('Retry-After', String(retryAfterSeconds));
    response.status(429).json({
      statusCode: 429,
      message:
        'Too many media requests. Retry after the current rate-limit window.',
      error: 'Too Many Requests',
    });
  };
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function removeExpiredEntries(
  entries: Map<string, RateLimitEntry>,
  now: number,
  windowMs: number,
): void {
  for (const [key, entry] of entries) {
    if (now - entry.windowStartedAt >= windowMs) {
      entries.delete(key);
    }
  }
}

function ensureCapacity(entries: Map<string, RateLimitEntry>): void {
  if (entries.size < MAX_TRACKED_CLIENTS) {
    return;
  }

  const oldestKey = entries.keys().next().value;

  if (oldestKey !== undefined) {
    entries.delete(oldestKey);
  }
}
