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
  TorrentDiscoveryHttpQuery,
} from './media.service';
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
    enum: ['movie', 'series', 'anime'],
  })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiQuery({ name: 'imdb', required: false, type: String })
  @ApiQuery({ name: 'tmdb', required: false, type: String })
  @ApiQuery({ name: 'kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'shikimori', required: false, type: String })
  @ApiQuery({ name: 'myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.imdb', required: false, type: String })
  @ApiQuery({ name: 'ids.tmdb', required: false, type: String })
  @ApiQuery({ name: 'ids.kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'ids.shikimori', required: false, type: String })
  @ApiQuery({ name: 'ids.myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'ids.aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.worldArt', required: false, type: String })
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
    enum: ['movie', 'series', 'anime'],
  })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiQuery({ name: 'imdb', required: false, type: String })
  @ApiQuery({ name: 'tmdb', required: false, type: String })
  @ApiQuery({ name: 'kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'shikimori', required: false, type: String })
  @ApiQuery({ name: 'myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.imdb', required: false, type: String })
  @ApiQuery({ name: 'ids.tmdb', required: false, type: String })
  @ApiQuery({ name: 'ids.kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'ids.shikimori', required: false, type: String })
  @ApiQuery({ name: 'ids.myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'ids.aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.worldArt', required: false, type: String })
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
    enum: ['movie', 'series', 'anime'],
  })
  @ApiQuery({ name: 'title', required: false, type: String })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'seasonNumber', required: false, type: Number })
  @ApiQuery({ name: 'episodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'absoluteEpisodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'providers', required: false, type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiQuery({ name: 'imdb', required: false, type: String })
  @ApiQuery({ name: 'tmdb', required: false, type: String })
  @ApiQuery({ name: 'kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'shikimori', required: false, type: String })
  @ApiQuery({ name: 'myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.imdb', required: false, type: String })
  @ApiQuery({ name: 'ids.tmdb', required: false, type: String })
  @ApiQuery({ name: 'ids.kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'ids.shikimori', required: false, type: String })
  @ApiQuery({ name: 'ids.myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'ids.aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.worldArt', required: false, type: String })
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
    return runWithHttpRequestSignal(request, response, (signal) =>
      this.mediaService.getAvailability(query, { signal }),
    );
  }

  // EN: Expose normalized torrent candidates and handoff data without running a torrent client.
  // RU: Возвращает torrent-кандидаты и handoff без запуска torrent-клиента.
  @ApiOperation({
    summary:
      'Discover torrent handoff candidates for one media item or episode.',
    description:
      'Returns metadata and handoff data only. The API does not download torrents, join swarms, store files, proxy media, or transcode video.',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: ['movie', 'series', 'anime'],
  })
  @ApiQuery({ name: 'title', required: false, type: String })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'seasonNumber', required: false, type: Number })
  @ApiQuery({ name: 'episodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'absoluteEpisodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'providers', required: false, type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'imdb', required: false, type: String })
  @ApiQuery({ name: 'tmdb', required: false, type: String })
  @ApiQuery({ name: 'kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'shikimori', required: false, type: String })
  @ApiQuery({ name: 'myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.imdb', required: false, type: String })
  @ApiQuery({ name: 'ids.tmdb', required: false, type: String })
  @ApiQuery({ name: 'ids.kinopoisk', required: false, type: String })
  @ApiQuery({ name: 'ids.shikimori', required: false, type: String })
  @ApiQuery({ name: 'ids.myAnimeList', required: false, type: String })
  @ApiQuery({ name: 'ids.aniList', required: false, type: String })
  @ApiQuery({ name: 'ids.worldArt', required: false, type: String })
  @ApiOkResponse({ description: 'Normalized torrent discovery response.' })
  @ApiBadRequestResponse({ description: 'Invalid torrent discovery query.' })
  @ApiServiceUnavailableResponse({
    description: 'All selected torrent providers failed.',
  })
  @Get('torrents')
  discoverTorrents(
    @Query() query: TorrentDiscoveryHttpQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return runWithHttpRequestSignal(request, response, (signal) =>
      this.mediaService.discoverTorrents(query, { signal }),
    );
  }
}
