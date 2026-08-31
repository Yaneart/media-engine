import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const MEDIA_ENGINE_API_CONTRACT_VERSION = '0.13.0';

// EN: Register OpenAPI JSON and Swagger UI for the public REST API.
// RU: Регистрирует OpenAPI JSON и Swagger UI для публичного REST API.
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Media Engine API')
    .setDescription(
      'REST API for normalized media metadata and streaming availability.',
    )
    .setVersion(MEDIA_ENGINE_API_CONTRACT_VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Opaque server token',
        description:
          'Server-to-server authentication for original torrent session lifecycle routes.',
      },
      'originalTorrentSession',
    )
    .addTag('health', 'Liveness and provider-aware readiness status.')
    .addTag(
      'media',
      'Search and details endpoints for normalized media metadata.',
    )
    .addTag('providers', 'Configured provider capabilities by category.')
    .addTag(
      'torrent-discovery',
      'Opt-in torrent candidate discovery without torrent runtime or playback.',
    )
    .addTag(
      'original-torrent-sessions',
      'App-specific server-owned torrent lifecycle and file selection.',
    )
    .addTag(
      'original-torrent-streams',
      'Protected original-file GET/HEAD streaming with validated single-range semantics.',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
}
