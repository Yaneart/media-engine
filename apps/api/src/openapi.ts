import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// EN: Register OpenAPI JSON and Swagger UI for the public REST API.
// RU: Регистрирует OpenAPI JSON и Swagger UI для публичного REST API.
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Media Engine API')
    .setDescription('REST API for unified movie, series, and anime metadata.')
    .setVersion('0.0.0')
    .addTag('health', 'Readiness and basic service status.')
    .addTag(
      'media',
      'Search and details endpoints for normalized media metadata.',
    )
    .addTag('providers', 'Configured metadata provider capabilities.')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
}
