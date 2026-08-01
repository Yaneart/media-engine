# Beginner quick start

**English** | [Русский](quick-start.ru.md)

This guide builds the smallest useful browser-to-Media-Engine application:

```text
browser -> @media-engine/sdk -> your NestJS route -> MediaEngine -> public providers
```

The browser never calls providers directly. NestJS owns one `MediaEngine` instance, so requests
share its cache, concurrency limits, and provider health state.

You need Node.js 20.19 or newer (or Node.js 22.12+ for the current Vite scaffold). Media Engine
packages themselves support Node.js 20+. The example uses npm and two terminal windows.

## 1. Create the NestJS backend

```bash
npx @nestjs/cli@11 new media-backend --package-manager npm --strict --skip-git
cd media-backend
npm install @media-engine/core @media-engine/providers
```

Add `src/media-engine.provider.ts`:

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

Keep the dynamic imports in the asynchronous factory. The Media Engine packages are ESM, and this
form also works in the standard NestJS CommonJS application output.

Add `src/media.controller.ts`:

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

Replace `src/app.module.ts`:

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

In `src/main.ts`, allow the local frontend origin:

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

Start the backend:

```bash
npm run start:dev
```

Check it before creating the frontend:

```bash
curl 'http://localhost:3000/media/search?title=Interstellar'
```

You should receive JSON with a `results` array. Public sources can be temporarily unavailable, so
a successful partial response may also contain `meta.providers.failed`.

## 2. Create the frontend

In a second terminal:

```bash
npm create vite@latest media-web -- --template vanilla-ts
cd media-web
npm install
npm install @media-engine/sdk
```

Replace `src/main.ts`:

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
    const response = await media.search({ title: 'Interstellar' });
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

Start Vite:

```bash
npm run dev
```

Open <http://localhost:5173>. The page should display the search results returned by your NestJS
backend.

## 3. The important boundary

- Backend: install `@media-engine/core` and `@media-engine/providers`, create providers, and own the
  long-lived `MediaEngine` instance.
- Frontend: install only `@media-engine/sdk` and set `baseUrl` to your backend.
- Do not put provider calls, server credentials, or private torrent-session tokens in browser code.
- In production, replace the local CORS origin and SDK `baseUrl` with your deployed frontend and
  API origins.

This minimal backend intentionally exposes only search. The SDK also supports `getDetails()`,
`getAvailability()`, `discoverTorrents()`, and health/provider methods after your backend adds the
matching routes. Details routes should accept namespaced external IDs such as
`{ imdb: 'tt0816692' }`, not an ambiguous plain `id`.

See the [public API guide](public-api.md) for those operations and the
[provider guide](providers.md) before enabling additional sources.
