import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApiApplication } from './bootstrap';
import { loadLocalEnv } from './env';
import { readApiRuntimeConfig } from './runtime-config';

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const config = readApiRuntimeConfig();

  const app = await NestFactory.create(AppModule);
  configureApiApplication(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
}

void bootstrap().catch((error: unknown) => {
  console.error('Media Engine API failed to start.', error);
  process.exitCode = 1;
});
