import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  Head,
  HttpException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPartialContentResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OriginalTorrentStreamCapabilityError } from '../original-torrent-session/session.errors';
import { OriginalTorrentUpstreamStreamError } from './stream.errors';
import { OriginalTorrentStreamGateway } from './stream-gateway';
import { OriginalTorrentRangeInputError } from './stream-range';

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;

@ApiTags('original-torrent-streams')
@Controller('media/torrent-streams')
export class OriginalTorrentStreamController {
  constructor(private readonly gateway: OriginalTorrentStreamGateway) {}

  @ApiOperation({
    summary: 'Inspect the exact selected original torrent file headers.',
  })
  @ApiParam({
    name: 'capability',
    description: 'Expiring high-entropy stream capability.',
  })
  @ApiOkResponse({ description: 'Complete original file headers.' })
  @ApiPartialContentResponse({
    description: 'Validated single byte range headers.',
  })
  @ApiBadRequestResponse({ description: 'Malformed or multi-range request.' })
  @ApiGoneResponse({ description: 'Stopped, expired, or invalid capability.' })
  @Head(':capability')
  head(
    @Param('capability') capability: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.handle(capability, request, response, 'HEAD');
  }

  @ApiOperation({ summary: 'Stream the exact selected original torrent file.' })
  @ApiParam({
    name: 'capability',
    description: 'Expiring high-entropy stream capability.',
  })
  @ApiOkResponse({ description: 'Complete original file stream.' })
  @ApiPartialContentResponse({ description: 'Validated single byte range.' })
  @ApiBadRequestResponse({ description: 'Malformed or multi-range request.' })
  @ApiGoneResponse({ description: 'Stopped, expired, or invalid capability.' })
  @ApiBadGatewayResponse({ description: 'Invalid TorrServer stream response.' })
  @ApiServiceUnavailableResponse({
    description: 'Torrent pieces are temporarily unavailable.',
  })
  @Get(':capability')
  get(
    @Param('capability') capability: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.handle(capability, request, response, 'GET');
  }

  private async handle(
    capability: string,
    request: Request,
    response: Response,
    method: 'GET' | 'HEAD',
  ): Promise<void> {
    if (!CAPABILITY.test(capability)) {
      throw new BadRequestException('Stream capability is invalid.');
    }
    try {
      await this.gateway.handle(request, response, capability, method);
    } catch (error) {
      if (error instanceof OriginalTorrentRangeInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof OriginalTorrentStreamCapabilityError) {
        throw new GoneException({
          statusCode: 410,
          code: error.code,
          message: error.message,
          error: 'Gone',
        });
      }
      if (error instanceof OriginalTorrentUpstreamStreamError) {
        throw new HttpException(
          {
            statusCode:
              error.failure.code === 'torrent_pieces_unavailable' ? 503 : 502,
            code: error.failure.code,
            message: error.failure.message,
            error:
              error.failure.code === 'torrent_pieces_unavailable'
                ? 'Service Unavailable'
                : 'Bad Gateway',
          },
          error.failure.code === 'torrent_pieces_unavailable' ? 503 : 502,
        );
      }
      throw error;
    }
  }
}
