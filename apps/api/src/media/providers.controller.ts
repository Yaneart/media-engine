import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MediaService } from './media.service';

@ApiTags('providers')
@Controller('providers')
// EN: Public provider metadata controller for REST clients.
// RU: Публичный controller метаданных провайдеров для REST-клиентов.
export class ProvidersController {
  constructor(private readonly mediaService: MediaService) {}

  // EN: Return safe provider capabilities without secrets or internals.
  // RU: Возвращает безопасные capabilities провайдеров без секретов и внутренностей.
  @ApiOperation({ summary: 'List configured metadata providers.' })
  @ApiOkResponse({ description: 'Safe provider metadata and capabilities.' })
  @Get()
  getProviders() {
    return this.mediaService.getProviders();
  }

  // EN: Return safe streaming provider capabilities without secrets or internals.
  // RU: Возвращает безопасные capabilities streaming-провайдеров без секретов и внутренностей.
  @ApiOperation({ summary: 'List configured streaming providers.' })
  @ApiOkResponse({
    description: 'Safe streaming provider metadata and capabilities.',
  })
  @Get('streaming')
  getStreamingProviders() {
    return this.mediaService.getStreamingProviders();
  }

  // EN: Return safe torrent provider capabilities without secrets or internals.
  // RU: Возвращает безопасные capabilities torrent-провайдеров без секретов и внутренностей.
  @ApiOperation({ summary: 'List configured torrent discovery providers.' })
  @ApiOkResponse({
    description: 'Safe torrent provider metadata and capabilities.',
  })
  @Get('torrent')
  getTorrentProviders() {
    return this.mediaService.getTorrentProviders();
  }
}
