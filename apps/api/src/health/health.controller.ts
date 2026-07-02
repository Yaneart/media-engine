import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // EN: Expose the first API readiness endpoint for infrastructure checks.
  // RU: Открываем первый endpoint готовности API для инфраструктурных проверок.
  @ApiOperation({ summary: 'Check API readiness.' })
  @ApiOkResponse({ description: 'API is ready.' })
  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }
}
