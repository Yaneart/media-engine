# @media-engine/providers

[English](https://github.com/Yaneart/media-engine/blob/main/packages/providers/README.md) | **Русский**

Это готовые источники данных для Media Engine. Установите пакет, если хотите искать в реальных
публичных каталогах и не писать адаптеры самостоятельно.

## Установка

```bash
npm install @media-engine/core @media-engine/providers
```

Для встроенных провайдеров ваши API-ключи не нужны.

## Поиск метаданных

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
  ],
});

const result = await media.search({ title: "Ван-Пис" });
```

Подключайте только те источники, которые нужны вашему приложению. Движок сам вызовет подходящие
провайдеры и объединит совпадающие результаты.

Готовые провайдеры метаданных:

- `kinobdProvider()` и `cinemetaProvider()` для фильмов и сериалов;
- `shikimoriProvider()` и `aniListProvider()` для аниме;
- `tvMazeProvider()` и `wikidataProvider()` как дополнительные источники идентичности;
- `imdbDatasetProvider()` для IMDb-датасета, которым управляет ваше приложение.

Данные TVmaze требуют указания источника. Сохраняйте и показывайте ссылку TVmaze, которая приходит
в результате. Подробности есть в [лицензии API TVmaze](https://www.tvmaze.com/api#licensing).

Опциональные инструменты для SQLite-индекса IMDb требуют Node.js 22.13 или новее. Для остального
пакета достаточно Node.js 20.

## Поиск вариантов просмотра

```ts
import {
  flixHqStreamingProvider,
  kinobdStreamingProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  streamingProviders: [kinobdStreamingProvider(), flixHqStreamingProvider()],
});

const result = await media.getAvailability({
  type: "series",
  title: "Игра престолов",
  seasonNumber: 1,
  episodeNumber: 1,
});
```

Пакет также экспортирует `ddbbStreamingProvider()`, `aniLibertyStreamingProvider()`,
`filmixStreamingProvider()`, `veoVeoStreamingProvider()`, `videoHubStreamingProvider()`,
`rutubeStreamingProvider()` и
`experimentalStreamingProvider()`.
Подключайте их явно, если они
подходят вашему приложению. Filmix работает без аккаунта и в гостевом режиме возвращает только
подтверждённый полный MP4 480p. Текущий endpoint метаданных использует обычный HTTP, а полученные
ссылки на видео CDN используют HTTPS. VeoVeo использует DDBB только для получения публичного
content ID, отбрасывает iframe-токен и возвращает прямой подписанный HTTPS HLS.
VideoHUB ищет по ID Кинопоиска, а для сериала требует точный сезон и серию. Он возвращает
короткоживущие прямые MP4 в нескольких качествах. Ссылки привязаны к User-Agent проигрывающего
клиента и могут быть привязаны к внешнему IP. Передавайте точный User-Agent клиента через
`MediaEngineOperationOptions.playbackUserAgent`; для небраузерных клиентов нужное значение также
сохраняется в `access.headers` каждого варианта.
Rutube выполняет ограниченный точный поиск фильма по названию и году и возвращает только
официальный публичный embed-плеер Rutube. Прямые media-URL не извлекаются и не проксируются;
сериалы намеренно не поддерживаются.

Эти провайдеры возвращают сторонние ссылки или потоки. Media Engine не хранит видео, а внешний
плеер может быть недоступен в конкретной стране, сети или браузере.

## Поиск torrent-раздач

Torrent-провайдеры всегда подключаются явно:

```ts
import {
  bitsearchTorrentProvider,
  jacRedTorrentProvider,
  magnetzTorrentProvider,
  ytsTorrentProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  torrentProviders: [
    ytsTorrentProvider(),
    jacRedTorrentProvider(),
    bitsearchTorrentProvider(),
    magnetzTorrentProvider(),
  ],
});

const result = await media.discoverTorrents({
  type: "movie",
  title: "Начало",
  year: 2010,
  ids: { imdb: "tt1375666" },
});
```

Поиск только возвращает список кандидатов и данные для дальнейшей передачи. Он не загружает
torrent metadata, не обращается к trackers, не подключается к раздаче и не воспроизводит файл.

Публичные источники могут меняться, ограничивать запросы или временно не работать. Оставляйте кэш
движка включённым и будьте готовы к частичным результатам. Настройки и границы безопасности каждого
источника описаны в
[документации провайдеров](https://github.com/Yaneart/media-engine/blob/main/docs/providers.md).

## Лицензия

MIT
