import { DEFAULT_CORS_ORIGINS, readApiRuntimeConfig } from './runtime-config';

describe('API runtime config', () => {
  it('uses loopback-safe local defaults', () => {
    expect(readApiRuntimeConfig({})).toEqual({
      environment: 'development',
      host: '127.0.0.1',
      port: 3000,
      corsOrigins: [...DEFAULT_CORS_ORIGINS],
      rateLimit: {
        windowMs: 60_000,
        maxRequests: 60,
      },
    });
  });

  it('parses exact deployment overrides and removes duplicate origins', () => {
    expect(
      readApiRuntimeConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '8080',
        CORS_ORIGINS:
          'https://media.example,https://admin.example,https://media.example',
        MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS: '30000',
        MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS: '25',
      }),
    ).toEqual({
      environment: 'production',
      host: '0.0.0.0',
      port: 8080,
      corsOrigins: ['https://media.example', 'https://admin.example'],
      rateLimit: {
        windowMs: 30_000,
        maxRequests: 25,
      },
    });
  });

  it.each([
    [{ NODE_ENV: 'prod' }, 'NODE_ENV'],
    [{ HOST: 'http://localhost' }, 'HOST'],
    [{ HOST: 'bad host' }, 'HOST'],
    [{ PORT: '3000junk' }, 'PORT'],
    [{ PORT: '0' }, 'PORT'],
    [{ PORT: '65536' }, 'PORT'],
    [{ CORS_ORIGINS: '*' }, 'CORS_ORIGINS'],
    [{ CORS_ORIGINS: 'https://example.com/path' }, 'CORS_ORIGINS'],
    [{ CORS_ORIGINS: 'https://user@example.com' }, 'CORS_ORIGINS'],
    [{ MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS: '999' }, 'WINDOW_MS'],
    [{ MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS: '-1' }, 'MAX_REQUESTS'],
  ] satisfies Array<[NodeJS.ProcessEnv, string]>)(
    'rejects invalid %j',
    (env, name) => {
      expect(() => readApiRuntimeConfig(env)).toThrow(name);
    },
  );

  it('requires an explicit production CORS allowlist', () => {
    expect(() => readApiRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'CORS_ORIGINS must be set explicitly in production.',
    );
  });

  it('allows explicitly disabling the process-local rate limit', () => {
    expect(
      readApiRuntimeConfig({
        MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS: '0',
      }).rateLimit.maxRequests,
    ).toBe(0);
  });
});
