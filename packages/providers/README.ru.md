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

for await (const snapshot of media.getAvailabilityProgressively({
  type: "series",
  ids: { kinopoisk: "435" },
  seasonNumber: 1,
  episodeNumber: 1,
})) {
  updatePlayerSources(snapshot.availability?.options ?? []);
}
```

Пакет также экспортирует `ddbbStreamingProvider()`, `aniLibertyStreamingProvider()`,
`filmixStreamingProvider()`, `veoVeoStreamingProvider()`, `videoHubStreamingProvider()`,
`rutubeStreamingProvider()` и
`experimentalStreamingProvider()`.
Подключайте их явно, если они
подходят вашему приложению. Гостевой режим Filmix ограничен 480p и отбрасывает известные заглушки о
блокировке и служебные видео. Собственный device token повышает предел до 720p. Для авторизации
обязателен HTTPS `baseUrl`, если приложение явно не включило `allowInsecureHttpToken` для локальной
проверки совместимости. Этот режим отправляет токен без TLS и не должен использоваться в публичном
развёртывании. Ссылки на видео CDN используют HTTPS. VeoVeo использует DDBB только для получения публичного
content ID, отбрасывает iframe-токен и возвращает прямой подписанный HTTPS HLS.
VideoHUB ищет по ID Кинопоиска и одним запросом playlist возвращает каталог сезонов и серий аниме.
Для воспроизведения сериала или аниме нужна точная серия: аниме можно запросить по абсолютному номеру
либо по паре сезон/серия; ответ сохраняет обе идентичности. Он возвращает
короткоживущие прямые MP4 в нескольких качествах. Ссылки привязаны к User-Agent проигрывающего
клиента и могут быть привязаны к внешнему IP. Передавайте точный User-Agent клиента через
`MediaEngineOperationOptions.playbackUserAgent`; для небраузерных клиентов нужное значение также
сохраняется в `access.headers` каждого варианта.
VideoHUB поддерживает прогрессивную доступность: каждый готовый перевод можно показать, не ожидая
более медленных lookup. Ограниченный warm-cache раздельно хранит плейлисты и ещё действующие
подписанные video resolutions, никогда не выдаёт подписанные ссылки stale и сохраняет их исходный
срок действия.
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
