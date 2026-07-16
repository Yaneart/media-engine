import { Inject, Injectable } from '@nestjs/common';
import type { MediaEngine, ProviderHealthStatus } from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';

// EN: Stable response contract for GET /health.
// RU: Стабильный контракт ответа для GET /health.
export interface HealthResponse {
  status: 'ok';
  service: 'media-engine-api';
  providers: ProviderHealthStatus[];
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly mediaEngine: MediaEngine,
  ) {}

  // EN: Return a tiny deterministic payload so monitoring can verify the API.
  // RU: Возвращаем маленький детерминированный ответ для проверки API мониторингом.
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'media-engine-api',
      providers: this.mediaEngine.getProviderHealth(),
    };
  }
}
