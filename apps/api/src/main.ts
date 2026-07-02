import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupOpenApi } from './openapi';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
  });
  setupOpenApi(app);

  // EN: Keep local defaults explicit while still allowing deployment overrides.
  // RU: Держим локальные значения явными, но оставляем переопределение для деплоя.
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.HOST ?? DEFAULT_HOST;

  await app.listen(Number.isFinite(port) ? port : DEFAULT_PORT, host);
}

void bootstrap();
