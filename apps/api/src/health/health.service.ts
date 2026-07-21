import { Inject, Injectable } from '@nestjs/common';
import type { MediaEngine, ProviderHealthStatus } from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';

export interface LivenessResponse {
  status: 'ok';
  service: 'media-engine-api';
}

// Stable readiness contract shared by GET /health and GET /health/ready.
// Стабильный readiness-контракт для GET /health и GET /health/ready.
export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'media-engine-api';
  providers: ProviderHealthStatus[];
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly mediaEngine: MediaEngine,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'media-engine-api',
    };
  }

  getReadiness(): HealthResponse {
    const providers = this.mediaEngine.getProviderHealth();
    const degraded = providers.some(
      (provider) =>
        provider.circuitState === 'open' ||
        provider.circuitState === 'half-open',
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'media-engine-api',
      providers,
    };
  }

  // Keep the original endpoint and SDK method backward compatible.
  // Сохраняет обратную совместимость исходного endpoint и SDK method.
  getHealth(): HealthResponse {
    return this.getReadiness();
  }
}
