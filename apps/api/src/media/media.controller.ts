import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import type {
  MediaAvailabilityHttpQuery,
  MediaDetailsHttpQuery,
  MediaSearchHttpQuery,
} from './media.service';

@ApiTags('media')
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
  @ApiOkResponse({ description: 'Merged search results.' })
  @ApiBadRequestResponse({ description: 'Invalid search query.' })
  @ApiServiceUnavailableResponse({
    description: 'All selected providers failed.',
  })
  @Get('search')
  search(@Query() query: MediaSearchHttpQuery) {
    return this.mediaService.search(query);
  }

  // EN: Expose merged metadata details for one media item.
  // RU: Открываем объединенные metadata details для одного media item.
  @ApiOperation({ summary: 'Get merged metadata details for one media item.' })
  @ApiQuery({ name: 'id', required: false, type: String })
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
  @ApiOkResponse({ description: 'Merged details response.' })
  @ApiBadRequestResponse({ description: 'Invalid details query.' })
  @ApiServiceUnavailableResponse({
    description: 'All selected providers failed.',
  })
  @Get('details')
  getDetails(@Query() query: MediaDetailsHttpQuery) {
    return this.mediaService.getDetails(query);
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
  @ApiOkResponse({ description: 'Normalized player availability response.' })
  @ApiBadRequestResponse({
    description: 'Invalid streaming availability query.',
  })
  @ApiServiceUnavailableResponse({
    description: 'All selected streaming providers failed.',
  })
  @Get('availability')
  getAvailability(@Query() query: MediaAvailabilityHttpQuery) {
    return this.mediaService.getAvailability(query);
  }
}
