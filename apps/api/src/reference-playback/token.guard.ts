import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReferencePlaybackRuntime } from './runtime';

@Injectable()
export class ReferencePlaybackTokenGuard implements CanActivate {
  constructor(private readonly runtime: ReferencePlaybackRuntime) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.runtime.enabled) {
      throw new ServiceUnavailableException(
        'Reference torrent playback is disabled.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (this.runtime.authorizeBearer(request.headers.authorization)) {
      return true;
    }

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException(
      'A valid torrent playback token is required.',
    );
  }
}
