import { Controller, Get, Query } from '@nestjs/common';
import { MediaService } from './media.service';
import type {
  MediaDetailsHttpQuery,
  MediaSearchHttpQuery,
} from './media.service';

@Controller('media')
// EN: Public media metadata controller for REST clients.
// RU: Публичный metadata controller для REST-клиентов.
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // EN: Expose the first public metadata search endpoint.
  // RU: Открываем первый публичный endpoint поиска metadata.
  @Get('search')
  search(@Query() query: MediaSearchHttpQuery) {
    return this.mediaService.search(query);
  }

  // EN: Expose merged metadata details for one media item.
  // RU: Открываем объединенные metadata details для одного media item.
  @Get('details')
  getDetails(@Query() query: MediaDetailsHttpQuery) {
    return this.mediaService.getDetails(query);
  }
}
