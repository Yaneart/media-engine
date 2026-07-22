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
  ddbbStreamingProvider,
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
- `imdbDatasetProvider()` — локальные данные IMDb в виде небольших in-memory TSV fixtures или через индексированный storage adapter приложения.

Для встроенных провайдеров не нужен ваш API-ключ. TMDB ID может встретиться в результате, но сам пакет не обращается к TMDB API.

Данные TVmaze распространяются по лицензии CC BY-SA. Провайдер сохраняет ссылку на страницу сериала TVmaze в source attribution; приложению следует сохранять и показывать эту ссылку. См. [условия API TVmaze](https://www.tvmaze.com/api#licensing).

Резервный поиск Wikidata загружает не больше трёх релевантных title entities через selected-property запрос и по умолчанию кеширует entity/IMDb mappings на шесть часов в process-local LRU на 256 записей. `entityLimit` ограничен диапазоном 1–10, `cacheTtlMs` — 0–7 дней, `cacheMaxEntries` — 2–2048; нулевой TTL отключает локальный cache провайдера.

Backward-compatible IMDb TSV adapter полностью разбирает входные строки в память и предназначен для небольших наборов и fixtures. Для полного датасета приложение может передать экспортируемый синхронный/асинхронный контракт `ImdbDatasetStorage` с прямым ID lookup и ограниченным поиском по нормализованному title; другим пользователям пакета database dependency не добавляется.

Встроенный persisted adapter может потоково собрать plain или gzip IMDb TSV в версионированный SQLite/FTS index с атомарной заменой. `buildImdbDatasetSqliteIndex()` создаёт индекс, а `openImdbDatasetSqliteStorage()` открывает его read-only для `imdbDatasetProvider({ storage })`. Этот опциональный путь лениво использует встроенный `node:sqlite` и требует Node.js 22.13 или новее; импорт пакета и небольшой in-memory adapter сохраняют базовую совместимость с Node.js 20.

Ожидаемые сбои внешних источников возвращаются как типизированные `ProviderError`, а исходный HTTP status доступен через `getProviderHttpStatus`. Cinemeta при IMDb-запросе без типа возвращает `null`, только когда отсутствие подтверждено и для фильма, и для сериала; временный сбой одной ветки остаётся retryable, если другая ветка не вернула пригодные детали. AniList также отличает GraphQL rate limit и сбой сервера от ошибок валидации или некорректного ответа, поэтому Media Engine не кеширует неполные метаданные как здоровый результат.

Общий `fetchJson` по умолчанию читает потоково не больше 4 МиБ перед разбором JSON и принимает положительный `maxResponseBytes` для индивидуального лимита провайдера. Объявленное или фактическое превышение отменяет body и возвращает non-retryable `PROVIDER_RESPONSE_TOO_LARGE`; некорректный JSON в пределах лимита остаётся `PROVIDER_INVALID_RESPONSE`.

Низкоуровневые адаптеры могут передать `ProviderHttpScheduler` через
`FetchJsonOptions.scheduler`, когда нужен детерминированный контроль retry- и total-timeout
таймеров, прежде всего в тестах. Обычные provider-вызовы не задают его и используют системные
таймеры.

## Провайдеры плееров

- `kinobdStreamingProvider()` — варианты плееров для фильмов, сериалов и аниме;
- `flixHqStreamingProvider()` — международные варианты для фильмов и выбранных эпизодов сериалов;
- `ddbbStreamingProvider()` — opt-in поиск по Kinopoisk/IMDb через независимый маршрут DDBB;
- `aniLibertyStreamingProvider()` — opt-in точный поиск аниме по названию/году с прямыми HLS-сериями;
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

`ddbbStreamingProvider()` намеренно не включён в API defaults репозитория. Он принимает только ID
Kinopoisk или IMDb, возвращает общие embed-плееры для фильмов/сериалов/anime и не заявляет точное
сопоставление сезона/эпизода. Diversity-first mapping сначала сохраняет по одному основному варианту
каждого возвращённого плеера, а затем добавляет уникальные translation URL. Nullable отсутствующие
плееры дают пустой результат; подтверждённые 404/410 и устойчивые deletion markers удаляются, а
transient ошибки проверки сохраняются как `unknown`.

```ts
const media = new MediaEngine({
  streamingProviders: [
    kinobdStreamingProvider(),
    flixHqStreamingProvider(),
    ddbbStreamingProvider(), // явное opt-in подключение
    aniLibertyStreamingProvider(), // явное opt-in подключение
  ],
});
```

`aniLibertyStreamingProvider()` также не входит в API defaults репозитория. AniLiberty не публикует
для релизов MAL, AniList или Shikimori ID, поэтому адаптер требует одновременно название и год,
принимает только одно точное нормализованное совпадение и повторно проверяет загруженный релиз перед
возвратом потоков. Он поддерживает общую карту серий и точный `absoluteEpisodeNumber`, но не угадывает
season/episode. Каждый безопасный first-party URL 480p/720p/1080p возвращается как прямой HLS, а
географическая и copyright-блокировка релиза сохраняются в нормализованном availability status.

Live-проверка удаляет вариант плеера только после HTTP 404/410 или устойчивого маркера удаления. Rate limit, ошибка сервера, сетевой сбой или timeout проверки сохраняют найденный вариант с `availability: "unknown"`, чтобы engine показал деградацию и повторил проверку вместо кеширования временно урезанного результата.

KinoBD по умолчанию ограничивает один availability lookup 24 дочерними HTTP-попытками и проверяет не больше восьми найденных плееров тремя workers. Публичная настройка также ограничена сверху (`childRequestLimit` до 64, `playerValidationLimit` до 16 и `playerValidationConcurrency` до 4). Вложенная iframe-проверка начинается, только если фиксированный deadline провайдера ещё позволяет выделить полное окно validation. Callback `onPlayerAudit` получает дополнительные `metrics`: найденные и проверенные плееры, пропуски по limit/budget, transient unknown, подтверждённые удаления и использованные дочерние запросы.

Навигация по FlixHQ не может покинуть настроенный origin, в том числе через redirects. Для внешних player/subtitle проверяются все A/AAAA-адреса, отклоняются private, local, reserved, multicast и смешанные public/private назначения, каждый ограниченный redirect hop валидируется, а соединение закрепляется за проверенным адресом. Пользовательский provider `fetch` считается явно доверенной transport-инъекцией для контролируемых тестов или self-hosted окружений и должен обеспечивать эквивалентную сетевую политику.

DDBB ограничивает размер JSON-ответа, количество output options и live validations, concurrency,
размер validation body и timeout каждого плеера. Его default transport применяет ту же hardened
политику DNS, redirects и connection pinning к endpoint DDBB и возвращённым плеерам. Пользовательский
`fetch` остаётся явной доверенной границей для тестов/self-hosted окружений.

AniLiberty ограничивает число search-кандидатов и эпизодов релиза, размер JSON, retry и общее время
провайдера через общие engine/provider-механизмы. Default transport применяет hardened DNS,
redirect и connection-pinning политику к API-вызовам. Прямые HLS-цели проходят общую browser-facing
проверку URL; playback network policy остаётся ответственностью потребляющего приложения.

Перед публикацией artwork, player или subtitle URL встроенные провайдеры применяют одну output-политику: разрешены только HTTP(S)-цели без credentials, исходных управляющих символов и literal local/private/reserved адресов. Валидные пути и CDN query-параметры, включая временные подписи, сохраняются. Эта browser-facing проверка не заменяет DNS-валидацию или media proxy приложения.

Настройки, ограничения и правила безопасности кратко описаны в [документации провайдеров](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## Лицензия

MIT
