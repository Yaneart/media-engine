import { Controller, Get, Query } from '@nestjs/common';
import { MediaSearchService } from './media-search.service';
import type { MediaSearchHttpQuery } from './media-search.service';

@Controller('media')
// EN: Public media metadata controller for REST clients.
// RU: Публичный metadata controller для REST-клиентов.
export class MediaController {
  constructor(private readonly mediaSearchService: MediaSearchService) {}

  // EN: Expose the first public metadata search endpoint.
  // RU: Открываем первый публичный endpoint поиска metadata.
  @Get('search')
  search(@Query() query: MediaSearchHttpQuery) {
    return this.mediaSearchService.search(query);
  }
}
