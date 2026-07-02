import { Injectable } from '@nestjs/common';

// EN: Stable response contract for GET /health.
// RU: Стабильный контракт ответа для GET /health.
export interface HealthResponse {
  status: 'ok';
  service: 'media-engine-api';
}

@Injectable()
export class HealthService {
  // EN: Return a tiny deterministic payload so monitoring can verify the API.
  // RU: Возвращаем маленький детерминированный ответ для проверки API мониторингом.
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'media-engine-api',
    };
  }
}
