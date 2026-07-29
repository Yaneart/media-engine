import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const ORIGINAL_TORRENT_SESSION_AUTH_CONFIG = Symbol(
  'ORIGINAL_TORRENT_SESSION_AUTH_CONFIG',
);

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

export interface OriginalTorrentSessionAuthEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN?: string;
}

export interface OriginalTorrentSessionAuthConfig {
  token?: string;
}

export function readOriginalTorrentSessionAuthConfig(
  env: OriginalTorrentSessionAuthEnv = process.env,
): OriginalTorrentSessionAuthConfig {
  const value = env.MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN;

  if (value === undefined || value.length === 0) {
    return {};
  }

  if (
    value.trim() !== value ||
    value.length < MIN_TOKEN_LENGTH ||
    value.length > MAX_TOKEN_LENGTH ||
    Array.from(value).some((character) => /\s|\p{Cc}/u.test(character))
  ) {
    throw new Error(
      `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN must contain ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} non-whitespace, non-control characters.`,
    );
  }

  return { token: value };
}

@Injectable()
export class OriginalTorrentSessionTokenGuard implements CanActivate {
  constructor(
    @Inject(ORIGINAL_TORRENT_SESSION_AUTH_CONFIG)
    private readonly config: OriginalTorrentSessionAuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.token === undefined) {
      throw new ServiceUnavailableException(
        'Original torrent sessions are disabled until server authentication is configured.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (matchesBearerToken(request.headers.authorization, this.config.token)) {
      return true;
    }

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException(
      'A valid original torrent session token is required.',
    );
  }
}

function matchesBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return false;
  }

  const received = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
