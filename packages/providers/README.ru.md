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
  tvMazeProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), shikimoriProvider(), aniListProvider(), tvMazeProvider()],
});

const result = await media.search({ title: "Ван-Пис" });
```

Подключайте только те провайдеры, которые нужны вашему приложению. Media Engine сам вызовет подходящие и объединит совпадающие ответы.

## Провайдеры метаданных

- `kinobdProvider()` — локализованные данные фильмов и сериалов;
- `cinemetaProvider()` — данные фильмов и сериалов, связанные с IMDb;
- `shikimoriProvider()` — поиск и детали аниме;
- `aniListProvider()` — международные названия аниме, популярность и изображения;
- `tvMazeProvider()` — резервные IMDb identity сериалов и локализованные aliases;
- `wikidataProvider()` — резервная проверка identity и обогащение открытыми структурированными данными;
- `imdbDatasetProvider()` — локальные TSV-датасеты IMDb, переданные приложением.

Для встроенных провайдеров не нужен ваш API-ключ. TMDB ID может встретиться в результате, но сам пакет не обращается к TMDB API.

Данные TVmaze распространяются по лицензии CC BY-SA. Провайдер сохраняет ссылку на страницу сериала TVmaze в source attribution; приложению следует сохранять и показывать эту ссылку. См. [условия API TVmaze](https://www.tvmaze.com/api#licensing).

Ожидаемые сбои внешних источников возвращаются как типизированные `ProviderError`, а исходный HTTP status доступен через `getProviderHttpStatus`. Cinemeta при IMDb-запросе без типа возвращает `null`, только когда отсутствие подтверждено и для фильма, и для сериала; временный сбой одной ветки остаётся retryable, если другая ветка не вернула пригодные детали. AniList также отличает GraphQL rate limit и сбой сервера от ошибок валидации или некорректного ответа, поэтому Media Engine не кеширует неполные метаданные как здоровый результат.

Общий `fetchJson` по умолчанию читает потоково не больше 4 МиБ перед разбором JSON и принимает положительный `maxResponseBytes` для индивидуального лимита провайдера. Объявленное или фактическое превышение отменяет body и возвращает non-retryable `PROVIDER_RESPONSE_TOO_LARGE`; некорректный JSON в пределах лимита остаётся `PROVIDER_INVALID_RESPONSE`.

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

Live-проверка удаляет вариант плеера только после HTTP 404/410 или устойчивого маркера удаления. Rate limit, ошибка сервера, сетевой сбой или timeout проверки сохраняют найденный вариант с `availability: "unknown"`, чтобы engine показал деградацию и повторил проверку вместо кеширования временно урезанного результата.

Навигация по FlixHQ не может покинуть настроенный origin, в том числе через redirects. Для внешних player/subtitle проверяются все A/AAAA-адреса, отклоняются private, local, reserved, multicast и смешанные public/private назначения, каждый ограниченный redirect hop валидируется, а соединение закрепляется за проверенным адресом. Пользовательский provider `fetch` считается явно доверенной transport-инъекцией для контролируемых тестов или self-hosted окружений и должен обеспечивать эквивалентную сетевую политику.

Перед публикацией artwork, player или subtitle URL встроенные провайдеры применяют одну output-политику: разрешены только HTTP(S)-цели без credentials, исходных управляющих символов и literal local/private/reserved адресов. Валидные пути и CDN query-параметры, включая временные подписи, сохраняются. Эта browser-facing проверка не заменяет DNS-валидацию или media proxy приложения.

Настройки, ограничения и правила безопасности кратко описаны в [документации провайдеров](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## Лицензия

MIT
