import type { MediaEngine, ProviderHealthStatus } from '@media-engine/core';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('keeps liveness independent from upstream provider state', () => {
    const service = createService([providerHealth('open')]);

    expect(service.getLiveness()).toEqual({
      status: 'ok',
      service: 'media-engine-api',
    });
  });

  it('reports readiness as ok when circuits are closed or disabled', () => {
    const providers = [providerHealth('closed'), providerHealth('disabled')];
    const service = createService(providers);

    expect(service.getReadiness()).toEqual({
      status: 'ok',
      service: 'media-engine-api',
      providers,
    });
  });

  it.each(['open', 'half-open'] as const)(
    'reports readiness as degraded for a %s circuit',
    (circuitState) => {
      const providers = [
        providerHealth('closed'),
        providerHealth(circuitState),
      ];
      const service = createService(providers);

      expect(service.getReadiness()).toEqual({
        status: 'degraded',
        service: 'media-engine-api',
        providers,
      });
      expect(service.getHealth()).toEqual(service.getReadiness());
    },
  );
});

function createService(providers: ProviderHealthStatus[]): HealthService {
  const mediaEngine = {
    getProviderHealth: jest.fn().mockReturnValue(providers),
  } as unknown as MediaEngine;

  return new HealthService(mediaEngine);
}

function providerHealth(
  circuitState: ProviderHealthStatus['circuitState'],
): ProviderHealthStatus {
  return {
    provider: `provider-${circuitState}`,
    kind: 'metadata',
    circuitState,
    consecutiveFailures: circuitState === 'open' ? 3 : 0,
    totalRequests: 3,
    totalSuccesses: circuitState === 'closed' ? 3 : 0,
    totalFailures: circuitState === 'open' ? 3 : 0,
  };
}
