import type { INestApplication } from '@nestjs/common';
import { createRateLimitMiddleware } from './rate-limit';
import type { ApiRuntimeConfig } from './runtime-config';
import { createSecurityHeadersMiddleware } from './security';
import { setupOpenApi } from './openapi';

// Apply the same HTTP policy in production and e2e tests.
// Применяет одинаковую HTTP policy в production и e2e tests.
export function configureApiApplication(
  app: INestApplication,
  config: ApiRuntimeConfig,
): void {
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });
  app.use(
    createSecurityHeadersMiddleware({
      production: config.environment === 'production',
    }),
  );
  app.use(createRateLimitMiddleware(config.rateLimit));
  setupOpenApi(app);
}
