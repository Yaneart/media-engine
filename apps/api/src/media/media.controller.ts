import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import type {
  MediaAvailabilityHttpQuery,
  MediaDetailsHttpQuery,
  MediaSearchHttpQuery,
} from './media.service';
import { ApiExternalIdQueryParameters } from '../media-query/media-query.openapi';
import { MEDIA_TYPES } from '../media-query/media-query.constants';
import { runWithHttpRequestSignal } from './request-cancellation';

@ApiTags('media')
@ApiTooManyRequestsResponse({
  description: 'The process-local public media request limit was exceeded.',
})
@Controller('media')
// EN: Public media metadata controller for REST clients.
// RU: Публичный metadata controller для REST-клиентов.
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // EN: Expose the first public metadata search endpoint.
  // RU: Открываем первый публичный endpoint поиска metadata.
  @ApiOperation({ summary: 'Search movies, series, and anime metadata.' })
  @ApiQuery({ name: 'title', required: false, type: String })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [...MEDIA_TYPES],
  })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiExternalIdQueryParameters()
  @ApiOkResponse({ description: 'Merged search results.' })
  @ApiBadRequestResponse({ description: 'Invalid search query.' })
  @ApiServiceUnavailableResponse({
    description: 'All selected providers failed.',
  })
  @Get('search')
  search(
    @Query() query: MediaSearchHttpQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return runWithHttpRequestSignal(request, response, (signal) =>
      this.mediaService.search(query, { signal }),
    );
  }

  // EN: Expose merged metadata details for one media item.
  // RU: Открываем объединенные metadata details для одного media item.
  @ApiOperation({
    summary: 'Get merged metadata details for one media item.',
    description:
      'Use a named external ID such as imdb or kinopoisk, or an ids.* parameter. Plain provider-native IDs do not share a global namespace.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [...MEDIA_TYPES],
  })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiExternalIdQueryParameters()
  @ApiOkResponse({ description: 'Merged details response.' })
  @ApiBadRequestResponse({
    description: 'Invalid details query or unsupported id-only lookup.',
  })
  @ApiServiceUnavailableResponse({
    description: 'All selected providers failed.',
  })
  @Get('details')
  getDetails(
    @Query() query: MediaDetailsHttpQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return runWithHttpRequestSignal(request, response, (signal) =>
      this.mediaService.getDetails(query, { signal }),
    );
  }

  // EN: Expose normalized player and stream availability for one media item or episode.
  // RU: Открываем нормализованную доступность player и stream для медиа или эпизода.
  @ApiOperation({
    summary: 'Get available player options for one media item or episode.',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: [...MEDIA_TYPES],
  })
  @ApiQuery({ name: 'title', required: false, type: String })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'seasonNumber', required: false, type: Number })
  @ApiQuery({ name: 'episodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'absoluteEpisodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'providers', required: false, type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiExternalIdQueryParameters()
  @ApiOkResponse({ description: 'Normalized player availability response.' })
  @ApiBadRequestResponse({
    description: 'Invalid streaming availability query.',
  })
  @ApiServiceUnavailableResponse({
    description: 'All selected streaming providers failed.',
  })
  @Get('availability')
  getAvailability(
    @Query() query: MediaAvailabilityHttpQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return runWithHttpRequestSignal(request, response, (signal) => {
      const playbackUserAgent = readPlaybackUserAgent(request);
      return this.mediaService.getAvailability(query, {
        signal,
        ...(playbackUserAgent ? { playbackUserAgent } : {}),
      });
    });
  }
}

function readPlaybackUserAgent(request: Request): string | undefined {
  const value = request.get('user-agent')?.trim();
  return value && value.length <= 512 && !hasControlCharacter(value)
    ? value
    : undefined;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
