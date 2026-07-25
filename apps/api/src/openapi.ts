import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const MEDIA_ENGINE_API_CONTRACT_VERSION = '0.3.0';

// EN: Register OpenAPI JSON and Swagger UI for the public REST API.
// RU: Регистрирует OpenAPI JSON и Swagger UI для публичного REST API.
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Media Engine API')
    .setDescription(
      'REST API for normalized media metadata, streaming availability, torrent discovery, and optional protected reference playback.',
    )
    .setVersion(MEDIA_ENGINE_API_CONTRACT_VERSION)
    .addTag('health', 'Liveness and provider-aware readiness status.')
    .addTag(
      'media',
      'Search and details endpoints for normalized media metadata.',
    )
    .addTag('providers', 'Configured provider capabilities by category.')
    .addTag(
      'reference torrent playback',
      'Optional app-specific TorServer session lifecycle outside the public SDK.',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'operator-configured opaque token',
        description:
          'Separate in-memory/operator secret for reference torrent playback routes.',
      },
      'torrent-playback-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
}
