import { Controller, Get } from '@nestjs/common';
import { MediaService } from './media.service';

@Controller('providers')
// EN: Public provider metadata controller for REST clients.
// RU: Публичный controller метаданных провайдеров для REST-клиентов.
export class ProvidersController {
  constructor(private readonly mediaService: MediaService) {}

  // EN: Return safe provider capabilities without secrets or internals.
  // RU: Возвращает безопасные capabilities провайдеров без секретов и внутренностей.
  @Get()
  getProviders() {
    return this.mediaService.getProviders();
  }
}
