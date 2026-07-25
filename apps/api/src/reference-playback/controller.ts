import {
  BadRequestException,
  BadGatewayException,
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  GatewayTimeoutException,
  Head,
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
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
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
import {
  TorrentPlaybackStreamError,
  TorrentPlaybackStreamGateway,
} from './stream-gateway';
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
@Controller('reference/torrent-playback')
export class ReferencePlaybackController {
  constructor(
    private readonly sessions: TorrentPlaybackSessionService,
    private readonly runtime: ReferencePlaybackRuntime,
    private readonly streams: TorrentPlaybackStreamGateway,
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
  @ApiTooManyRequestsResponse({
    description: 'The playback-specific request limit was exceeded.',
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
  @ApiTooManyRequestsResponse({
    description: 'The playback-specific request limit was exceeded.',
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
  @ApiTooManyRequestsResponse({
    description: 'The playback-specific request limit was exceeded.',
  })
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
  @ApiTooManyRequestsResponse({
    description: 'The playback-specific request limit was exceeded.',
  })
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

  @ApiOperation({
    summary:
      'Stream one selected session file through a bounded byte-range gateway.',
    description:
      'The high-entropy, expiring session URL is the native-media capability. Hashes and file IDs are resolved exclusively from server-owned session state.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Complete media representation.' })
  @ApiResponse({ status: 206, description: 'One validated byte range.' })
  @ApiResponse({ status: 304, description: 'Representation was not modified.' })
  @ApiBadRequestResponse({ description: 'Invalid cache validator.' })
  @ApiNotFoundResponse({
    description: 'Session does not exist or has expired.',
  })
  @ApiResponse({
    status: 409,
    description: 'Session has no selected streamable file.',
  })
  @ApiResponse({
    status: 416,
    description: 'Malformed, multiple, or unsatisfiable range.',
  })
  @ApiResponse({
    status: 502,
    description: 'TorServer returned an invalid media response.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Playback is disabled or at stream capacity.',
  })
  @ApiResponse({ status: 504, description: 'TorServer stream timed out.' })
  @Get('sessions/:id/stream')
  async streamSession(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.serveStream(id, request, response);
  }

  @ApiOperation({
    summary: 'Read media headers for one selected playback session file.',
    description:
      'Uses the same expiring capability and validation boundary as GET without sending a media body.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Complete media headers.' })
  @ApiResponse({ status: 206, description: 'Validated byte-range headers.' })
  @ApiResponse({ status: 304, description: 'Representation was not modified.' })
  @ApiResponse({ status: 416, description: 'The byte range is invalid.' })
  @Head('sessions/:id/stream')
  async headStreamSession(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.serveStream(id, request, response);
  }

  private async serveStream(
    id: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    try {
      await runWithHttpRequestSignal(request, response, async (signal) => {
        const opened = await this.streams.open(parseSessionId(id), {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          range: request.headers.range,
          ifRange: request.headers['if-range'],
          ifNoneMatch: request.headers['if-none-match'],
          ifModifiedSince: request.headers['if-modified-since'],
          signal,
        });

        try {
          response.status(opened.status);
          opened.headers.forEach((value, name) =>
            response.setHeader(name, value),
          );

          if (opened.body === null) {
            response.end();
            return;
          }

          await pipeline(
            Readable.fromWeb(
              opened.body as unknown as NodeReadableStream<Uint8Array>,
            ),
            response,
            { signal },
          );
        } catch (error) {
          if (signal.aborted && signal.reason instanceof Error) {
            throw signal.reason;
          }

          throw error;
        } finally {
          opened.close();
        }
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      throw toStreamHttpException(error, response);
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

function toStreamHttpException(error: unknown, response: Response): Error {
  if (error instanceof TorrentPlaybackStreamError) {
    switch (error.code) {
      case 'disabled':
      case 'capacity_exceeded':
        return new ServiceUnavailableException(error.message);
      case 'invalid_request':
        return new BadRequestException(error.message);
      case 'invalid_range':
        response.setHeader('Accept-Ranges', 'bytes');

        if (error.fileLength !== undefined) {
          response.setHeader('Content-Range', `bytes */${error.fileLength}`);
        }

        return new HttpException(
          error.message,
          HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        );
      case 'upstream_unavailable':
      case 'upstream_invalid_response':
        return new BadGatewayException(error.message);
      case 'upstream_timeout':
        return new GatewayTimeoutException(error.message);
      case 'aborted':
        return new HttpException(error.message, HttpStatus.REQUEST_TIMEOUT);
    }
  }

  if (
    isTorrentPlaybackSessionError(error) &&
    error.code === 'session_not_streamable'
  ) {
    return new ConflictException(error.message);
  }

  return toHttpException(error);
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
    case 'session_not_streamable':
      return new ConflictException(error.message);
    case 'aborted':
      return new HttpException(error.message, HttpStatus.REQUEST_TIMEOUT);
  }
}
