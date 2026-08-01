# Быстрый старт для новичка

[English](quick-start.md) | **Русский**

В этом руководстве создаётся минимальное полезное приложение с Media Engine:

```text
browser -> @media-engine/sdk -> ваш NestJS route -> MediaEngine -> публичные провайдеры
```

Browser не обращается к провайдерам напрямую. NestJS владеет одним экземпляром `MediaEngine`,
поэтому запросы совместно используют его cache, ограничения concurrency и состояние провайдеров.

Понадобится Node.js 20.19 или новее (либо Node.js 22.12+ для актуального scaffold Vite), npm и два
окна терминала. Сами пакеты Media Engine поддерживают Node.js 20+.

## 1. Создайте backend на NestJS

```bash
npx @nestjs/cli@11 new media-backend --package-manager npm --strict --skip-git
cd media-backend
npm install @media-engine/core @media-engine/providers
```

Добавьте `src/media-engine.provider.ts`:

```ts
import type { Provider } from '@nestjs/common';
import type { MediaEngine } from '@media-engine/core';

export const MEDIA_ENGINE = Symbol('MEDIA_ENGINE');

export const mediaEngineProvider: Provider = {
  provide: MEDIA_ENGINE,
  useFactory: async (): Promise<MediaEngine> => {
    const [
      { MediaEngine },
      { cinemetaProvider, kinobdProvider, shikimoriProvider },
    ] = await Promise.all([
      import('@media-engine/core'),
      import('@media-engine/providers'),
    ]);

    return new MediaEngine({
      providers: [kinobdProvider(), cinemetaProvider(), shikimoriProvider()],
    });
  },
};
```

Сохраните dynamic imports внутри асинхронной factory. Пакеты Media Engine используют ESM, а такая
форма работает и со стандартным CommonJS output приложения NestJS.

Добавьте `src/media.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import type { MediaEngine } from '@media-engine/core';
import { MEDIA_ENGINE } from './media-engine.provider';

@Controller('media')
export class MediaController {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly media: MediaEngine,
  ) {}

  @Get('search')
  search(@Query('title') title?: string) {
    const normalizedTitle = title?.trim();

    if (!normalizedTitle) {
      throw new BadRequestException('title is required');
    }

    return this.media.search({ title: normalizedTitle, limit: 10 });
  }
}
```

Замените `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { mediaEngineProvider } from './media-engine.provider';

@Module({
  controllers: [MediaController],
  providers: [mediaEngineProvider],
})
export class AppModule {}
```

В `src/main.ts` разрешите origin локального frontend:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: 'http://localhost:5173' });
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

Запустите backend:

```bash
npm run start:dev
```

До создания frontend проверьте route:

```bash
curl 'http://localhost:3000/media/search?title=Interstellar'
```

В ответ придёт JSON с массивом `results`. Публичные источники могут временно не отвечать, поэтому
успешный частичный ответ может также содержать `meta.providers.failed`.

## 2. Создайте frontend

Во втором терминале:

```bash
npm create vite@latest media-web -- --template vanilla-ts
cd media-web
npm install
npm install @media-engine/sdk
```

Замените `src/main.ts`:

```ts
import { MediaEngineClient } from '@media-engine/sdk';

const media = new MediaEngineClient({
  baseUrl: 'http://localhost:3000',
});

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app element');
}

async function showSearch(root: HTMLDivElement) {
  root.textContent = 'Loading...';

  try {
    const response = await media.search({ title: 'Интерстеллар' });
    root.textContent = JSON.stringify(
      response.results.map((result) => result.item),
      null,
      2,
    );
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : 'Request failed';
  }
}

void showSearch(app);
```

Запустите Vite:

```bash
npm run dev
```

Откройте <http://localhost:5173>. Страница должна показать результаты, которые вернул ваш NestJS
backend.

## 3. Важная граница

- Backend: установите `@media-engine/core` и `@media-engine/providers`, создайте провайдеры и
  храните долгоживущий экземпляр `MediaEngine`.
- Frontend: установите только `@media-engine/sdk` и укажите адрес backend в `baseUrl`.
- Не помещайте вызовы провайдеров, server credentials или приватные torrent-session token в browser
  code.
- В production замените локальные CORS origin и SDK `baseUrl` адресами развёрнутых frontend и API.

Этот минимальный backend намеренно предоставляет только search. SDK также поддерживает
`getDetails()`, `getAvailability()`, `discoverTorrents()` и методы health/providers после того, как
backend добавит соответствующие routes. Route для details должен принимать внешний ID с namespace,
например `{ imdb: 'tt0816692' }`, а не неоднозначный обычный `id`.

Эти операции описаны в [руководстве по публичному API](public-api.md), а ограничения источников — в
[руководстве по провайдерам](providers.md).
