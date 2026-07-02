import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // EN: Keep local defaults explicit while still allowing deployment overrides.
  // RU: Держим локальные значения явными, но оставляем переопределение для деплоя.
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.HOST ?? DEFAULT_HOST;

  await app.listen(Number.isFinite(port) ? port : DEFAULT_PORT, host);
}

void bootstrap();
