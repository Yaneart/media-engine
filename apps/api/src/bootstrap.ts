import type { INestApplication } from '@nestjs/common';
import {
  createRateLimitMiddleware,
  isOriginalTorrentSessionCreationRequest,
} from './rate-limit';
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
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
  });
  app.use(
    createSecurityHeadersMiddleware({
      production: config.environment === 'production',
    }),
  );
  app.use(createRateLimitMiddleware(config.rateLimit));
  app.use(
    createRateLimitMiddleware({
      ...config.torrentSessionCreationRateLimit,
      matches: isOriginalTorrentSessionCreationRequest,
      code: 'torrent_session_creation_rate_exceeded',
      message:
        'Too many original torrent session creation requests from this client.',
    }),
  );
  setupOpenApi(app);
}
