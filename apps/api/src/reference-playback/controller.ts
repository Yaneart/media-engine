import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { runWithHttpRequestSignal } from '../media/request-cancellation';
import {
  isTorrentPlaybackSessionError,
  TorrentPlaybackSessionError,
} from './errors';
import { ReferencePlaybackRuntime } from './runtime';
import { TorrentPlaybackSessionService } from './session-service';
import { ReferencePlaybackTokenGuard } from './token.guard';
import type {
  CreateTorrentPlaybackSessionInput,
  TorrentPlaybackSessionSnapshot,
} from './types';

export const REFERENCE_PLAYBACK_SECURITY_NAME = 'torrent-playback-token';
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_PROVIDER_LENGTH = 128;
const MAX_CANDIDATE_ID_LENGTH = 1_024;

@ApiTags('reference torrent playback')
@ApiTooManyRequestsResponse({
  description: 'The playback-specific request limit was exceeded.',
})
@Controller('reference/torrent-playback')
export class ReferencePlaybackController {
  constructor(
    private readonly sessions: TorrentPlaybackSessionService,
    private readonly runtime: ReferencePlaybackRuntime,
  ) {}

  @ApiOperation({
    summary: 'Check the optional external TorServer reference path.',
    description:
      'This probe is separate from mandatory Media Engine readiness and never exposes credentials or the configured TorServer URL.',
  })
  @ApiOkResponse({
    description: 'Playback is disabled or TorServer is healthy.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Playback is configured but TorServer is unavailable.',
  })
  @Get('health')
  async health(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const health = await runWithHttpRequestSignal(request, response, (signal) =>
      this.runtime.health({ signal }),
    );

    if (health?.status === 'unavailable') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }

  @ApiOperation({ summary: 'Create one bounded torrent playback session.' })
  @ApiBearerAuth(REFERENCE_PLAYBACK_SECURITY_NAME)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'candidateId'],
      properties: {
        provider: { type: 'string', maxLength: MAX_PROVIDER_LENGTH },
        candidateId: { type: 'string', maxLength: MAX_CANDIDATE_ID_LENGTH },
        fileId: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiCreatedResponse({ description: 'A bounded playback session snapshot.' })
  @ApiBadRequestResponse({ description: 'Invalid or unplayable candidate.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid playback token.',
  })
  @ApiNotFoundResponse({
    description: 'Candidate is absent or no longer fresh.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Playback is disabled or session capacity is exhausted.',
  })
  @UseGuards(ReferencePlaybackTokenGuard)
  @Post('sessions')
  async createSession(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TorrentPlaybackSessionSnapshot | undefined> {
    const input = parseCreateSessionBody(body);

    try {
      return await runWithHttpRequestSignal(request, response, (signal) =>
        createSessionWithCancellation(this.sessions, input, signal),
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @ApiOperation({ summary: 'Get one owned playback session snapshot.' })
  @ApiBearerAuth(REFERENCE_PLAYBACK_SECURITY_NAME)
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'The requested playback session snapshot.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid playback token.',
  })
  @ApiNotFoundResponse({
    description: 'Session does not exist or has expired.',
  })
  @ApiServiceUnavailableResponse({ description: 'Playback is disabled.' })
  @UseGuards(ReferencePlaybackTokenGuard)
  @Get('sessions/:id')
  getSession(@Param('id') id: string): TorrentPlaybackSessionSnapshot {
    try {
      return this.sessions.getSession(parseSessionId(id));
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @ApiOperation({ summary: 'Stop and clean up one owned playback session.' })
  @ApiBearerAuth(REFERENCE_PLAYBACK_SECURITY_NAME)
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'The stopped playback session snapshot.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid playback token.',
  })
  @ApiNotFoundResponse({
    description: 'Session does not exist or has expired.',
  })
  @ApiServiceUnavailableResponse({ description: 'Playback is disabled.' })
  @UseGuards(ReferencePlaybackTokenGuard)
  @Delete('sessions/:id')
  async stopSession(
    @Param('id') id: string,
  ): Promise<TorrentPlaybackSessionSnapshot> {
    try {
      return await this.sessions.stopSession(parseSessionId(id));
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

function parseCreateSessionBody(
  value: unknown,
): CreateTorrentPlaybackSessionInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Request body must be an object.');
  }

  const keys = Object.keys(value);

  if (
    keys.some((key) => !['provider', 'candidateId', 'fileId'].includes(key))
  ) {
    throw new BadRequestException(
      'Only provider, candidateId, and optional fileId are accepted.',
    );
  }

  const provider = readBoundedString(
    value.provider,
    'provider',
    MAX_PROVIDER_LENGTH,
  );
  const candidateId = readBoundedString(
    value.candidateId,
    'candidateId',
    MAX_CANDIDATE_ID_LENGTH,
  );
  const fileId = value.fileId;

  if (
    fileId !== undefined &&
    (typeof fileId !== 'number' || !Number.isSafeInteger(fileId) || fileId < 1)
  ) {
    throw new BadRequestException('fileId must be a positive integer.');
  }

  return {
    provider,
    candidateId,
    ...(fileId === undefined ? {} : { fileId }),
  };
}

async function createSessionWithCancellation(
  sessions: TorrentPlaybackSessionService,
  input: CreateTorrentPlaybackSessionInput,
  signal: AbortSignal,
): Promise<TorrentPlaybackSessionSnapshot> {
  try {
    return await sessions.createSession(input, { signal });
  } catch (error) {
    if (signal.aborted && signal.reason instanceof Error) {
      throw signal.reason;
    }

    throw error;
  }
}

function parseSessionId(value: string): string {
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new NotFoundException('Playback session was not found.');
  }

  return value;
}

function readBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    throw new BadRequestException(
      `${name} must be a non-empty bounded string without surrounding whitespace.`,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toHttpException(error: unknown): Error {
  if (error instanceof HttpException) {
    return error;
  }

  if (!isTorrentPlaybackSessionError(error)) {
    return new ServiceUnavailableException(
      'Reference torrent playback is temporarily unavailable.',
    );
  }

  return mapSessionError(error);
}

function mapSessionError(error: TorrentPlaybackSessionError): HttpException {
  switch (error.code) {
    case 'disabled':
    case 'session_capacity_exceeded':
    case 'start_capacity_exceeded':
      return new ServiceUnavailableException(error.message);
    case 'candidate_not_found':
    case 'candidate_expired':
    case 'session_not_found':
      return new NotFoundException(error.message);
    case 'candidate_not_playable':
    case 'candidate_identity_mismatch':
    case 'invalid_file_selection':
      return new BadRequestException(error.message);
    case 'aborted':
      return new HttpException(error.message, HttpStatus.REQUEST_TIMEOUT);
  }
}
