import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { configureApiApplication } from './bootstrap';
import type { ApiRuntimeConfig } from './runtime-config';

describe('API application bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers CORS, security, rate limiting, and OpenAPI once', () => {
    const document = { openapi: '3.0.0' } as OpenAPIObject;
    const createDocument = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue(document);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation();
    const enableCors = jest.fn();
    const use = jest.fn();
    const app = {
      enableCors,
      use,
    } as unknown as INestApplication;
    const config: ApiRuntimeConfig = {
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
      corsOrigins: ['http://127.0.0.1:5173'],
      rateLimit: { windowMs: 60_000, maxRequests: 60 },
    };

    configureApiApplication(app, config);

    expect(enableCors).toHaveBeenCalledWith({
      origin: config.corsOrigins,
      methods: ['GET', 'HEAD', 'OPTIONS'],
    });
    expect(use).toHaveBeenCalledTimes(2);
    expect(createDocument).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        info: expect.objectContaining({
          title: 'Media Engine API',
          version: '0.1.0',
        }),
      }),
    );
    expect(setup).toHaveBeenCalledWith('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
    });
  });
});
