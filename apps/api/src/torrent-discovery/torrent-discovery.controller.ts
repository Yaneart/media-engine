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
import { runWithHttpRequestSignal } from '../media/request-cancellation';
import { MEDIA_TYPES } from '../media-query/media-query.constants';
import { ApiExternalIdQueryParameters } from '../media-query/media-query.openapi';
import type { TorrentDiscoveryHttpQuery } from './torrent-discovery.query';
import { TorrentDiscoveryService } from './torrent-discovery.service';

@ApiTags('torrent-discovery')
@ApiTooManyRequestsResponse({
  description: 'The process-local public media request limit was exceeded.',
})
@Controller('media')
export class TorrentDiscoveryController {
  constructor(private readonly torrentDiscovery: TorrentDiscoveryService) {}

  @ApiOperation({
    summary: 'Discover torrent handoff candidates for a media item or episode.',
    description:
      'Returns normalized discovery metadata and opaque handoff data only. This route does not join a swarm or provide playback.',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: [...MEDIA_TYPES],
  })
  @ApiQuery({ name: 'title', required: false, type: String })
  @ApiQuery({
    name: 'alternativeTitles',
    required: false,
    type: String,
    isArray: true,
  })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'seasonNumber', required: false, type: Number })
  @ApiQuery({ name: 'episodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'absoluteEpisodeNumber', required: false, type: Number })
  @ApiQuery({ name: 'providers', required: false, type: String })
  @ApiQuery({ name: 'language', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiExternalIdQueryParameters()
  @ApiOkResponse({ description: 'Normalized torrent discovery response.' })
  @ApiBadRequestResponse({ description: 'Invalid torrent discovery query.' })
  @ApiServiceUnavailableResponse({
    description: 'All selected torrent discovery providers failed.',
  })
  @Get('torrents')
  discover(
    @Query() query: TorrentDiscoveryHttpQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return runWithHttpRequestSignal(request, response, (signal) =>
      this.torrentDiscovery.discover(query, { signal }),
    );
  }
}

@ApiTags('torrent-discovery')
@Controller('providers')
export class TorrentProviderController {
  constructor(private readonly torrentDiscovery: TorrentDiscoveryService) {}

  @ApiOperation({ summary: 'List configured torrent discovery providers.' })
  @ApiOkResponse({
    description: 'Safe torrent provider metadata and capabilities.',
  })
  @Get('torrent')
  getProviders() {
    return this.torrentDiscovery.getProviders();
  }
}
