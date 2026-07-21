import { HealthController } from './health.controller';
import type { HealthResponse, LivenessResponse } from './health.service';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('delegates legacy, liveness, and readiness probes to the service', () => {
    const liveness: LivenessResponse = {
      status: 'ok',
      service: 'media-engine-api',
    };
    const readiness: HealthResponse = {
      status: 'degraded',
      service: 'media-engine-api',
      providers: [],
    };
    const getHealth = jest.fn().mockReturnValue(readiness);
    const getLiveness = jest.fn().mockReturnValue(liveness);
    const getReadiness = jest.fn().mockReturnValue(readiness);
    const healthService = {
      getHealth,
      getLiveness,
      getReadiness,
    } as unknown as HealthService;
    const controller = new HealthController(healthService);

    expect(controller.getHealth()).toBe(readiness);
    expect(controller.getLiveness()).toBe(liveness);
    expect(controller.getReadiness()).toBe(readiness);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(getLiveness).toHaveBeenCalledTimes(1);
    expect(getReadiness).toHaveBeenCalledTimes(1);
  });
});
