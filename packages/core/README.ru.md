# @media-engine/core

[English](https://github.com/Yaneart/media-engine/blob/main/packages/core/README.md) | **Русский**

Это сердце Media Engine. Оно обращается к нескольким источникам, понимает, какие результаты
относятся к одному тайтлу, объединяет ответы и не позволяет одному медленному или сломанному
источнику испортить весь запрос.

В core нет готовых источников данных. Проще всего начать, установив его вместе с пакетом провайдеров.

## Установка

```bash
npm install @media-engine/core @media-engine/providers
```

Нужен Node.js 20 или новее.

## Простой пример

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider, kinobdProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), cinemetaProvider()],
});

const result = await media.search({
  title: "Интерстеллар",
  language: "ru",
});

console.log(result.results[0]?.item);
```

Создайте один экземпляр `MediaEngine` и используйте его всё время, пока работает приложение.

## Основные операции

```ts
await media.search({ title: "Интерстеллар" });
await media.getDetails({ imdb: "tt0816692" });
await media.getAvailability({
  type: "series",
  title: "Игра престолов",
  seasonNumber: 1,
  episodeNumber: 1,
});

for await (const snapshot of media.getAvailabilityProgressively({
  type: "series",
  title: "Игра престолов",
  seasonNumber: 1,
  episodeNumber: 1,
})) {
  renderSources(snapshot.availability?.options ?? []);
  if (snapshot.state === "complete") stopLoading();
}
await media.discoverTorrents({
  type: "movie",
  title: "Интерстеллар",
  ids: { imdb: "tt0816692" },
});
```

Для `getDetails()` нужен внешний ID с указанием его типа: например, `imdb`, `kinopoisk` или
`ids.shikimori`. Обычный внутренний `id` провайдера не уникален между разными источниками.

Поиск плееров и torrent-раздач заработает только после подключения подходящих streaming- и
torrent-провайдеров.

`getAvailabilityProgressively()` возвращает не привязанный к транспорту `AsyncIterable`. Пока
`pendingProviders` не пуст, он публикует объединённые промежуточные снимки, а последний снимок всегда
помечает как `complete`. Существующий Promise `getAvailability()` по-прежнему возвращает только
финальный результат. HTTP-приложение само выбирает способ доставки; Core не привязан к SSE или
WebSocket.

## Что core делает сам

- параллельно вызывает подходящие провайдеры;
- объединяет дубликаты фильмов, сериалов и аниме;
- возвращает полезные данные, даже если один источник упал;
- поддерживает таймауты, кэш, отмену и объединение одинаковых запросов;
- приводит ошибки к общему виду и показывает сбои провайдеров в metadata ответа;
- экспортирует публичные типы и контракты для собственных провайдеров.

Core не хранит видео, не открывает torrent-файлы, не подключается к раздаче и не перекодирует медиа.
Провайдеры возвращают варианты в едином формате, а дальнейшее поведение определяет ваше приложение.

Поля запросов, настройки, собственные провайдеры и ответы описаны в
[руководстве по публичному API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md).
Точным справочником служат экспортируемые TypeScript-типы.

## Лицензия

MIT
