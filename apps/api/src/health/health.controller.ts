import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @ApiOperation({ summary: 'Check API readiness (backward-compatible alias).' })
  @ApiOkResponse({ description: 'API is ready or serving in degraded mode.' })
  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }

  @ApiOperation({ summary: 'Check whether the API process is alive.' })
  @ApiOkResponse({ description: 'API process is alive.' })
  @Get('live')
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @ApiOperation({ summary: 'Check provider-aware API readiness.' })
  @ApiOkResponse({ description: 'API is ready or serving in degraded mode.' })
  @Get('ready')
  getReadiness() {
    return this.healthService.getReadiness();
  }
}
