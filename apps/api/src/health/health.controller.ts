import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // EN: Expose the first API readiness endpoint for infrastructure checks.
  // RU: Открываем первый endpoint готовности API для инфраструктурных проверок.
  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }
}
