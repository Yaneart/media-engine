# @media-engine/providers

[English](https://github.com/Yaneart/media-engine/blob/main/packages/providers/README.md) | **Русский**

Готовые источники данных для Media Engine.

Установите этот пакет, если не хотите писать собственные адаптеры провайдеров.

```bash
npm install @media-engine/core @media-engine/providers
```

## Небольшой пример

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  flixHqStreamingProvider,
  kinobdProvider,
  kinobdStreamingProvider,
  shikimoriProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), shikimoriProvider(), aniListProvider()],
});

const result = await media.search({ title: "Ван-Пис" });
```

Подключайте только те провайдеры, которые нужны вашему приложению. Media Engine сам вызовет подходящие и объединит совпадающие ответы.

## Провайдеры метаданных

- `kinobdProvider()` — локализованные данные фильмов и сериалов;
- `cinemetaProvider()` — данные фильмов и сериалов, связанные с IMDb;
- `shikimoriProvider()` — поиск и детали аниме;
- `aniListProvider()` — международные названия аниме, популярность и изображения;
- `wikidataProvider()` — обогащение открытыми структурированными данными;
- `imdbDatasetProvider()` — локальные TSV-датасеты IMDb, переданные приложением.

Для встроенных провайдеров не нужен ваш API-ключ. TMDB ID может встретиться в результате, но сам пакет не обращается к TMDB API.

## Провайдеры плееров

- `kinobdStreamingProvider()` — варианты плееров для фильмов, сериалов и аниме;
- `flixHqStreamingProvider()` — международные варианты для фильмов и выбранных эпизодов сериалов;
- `experimentalStreamingProvider()` — данные, настроенные вашим приложением для тестов и разработки интерфейса.

```ts
const media = new MediaEngine({
  streamingProviders: [
    kinobdStreamingProvider(),
    flixHqStreamingProvider(),
  ],
});

const result = await media.getAvailability({
  type: "series",
  title: "Game of Thrones",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

Это ссылки на сторонние плееры, а не видео, размещённые Media Engine. Доступность зависит от внешнего источника и окружения пользователя.

Настройки, ограничения и правила безопасности кратко описаны в [документации провайдеров](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## Лицензия

MIT
