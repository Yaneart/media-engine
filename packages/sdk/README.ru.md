# @media-engine/sdk

[English](https://github.com/Yaneart/media-engine/blob/main/packages/sdk/README.md) | **Русский**

Это небольшой типизированный клиент для HTTP API Media Engine. Используйте его в браузере, боте или
другом сервисе, чтобы не собирать URL запросов вручную.

## Установка

```bash
npm install @media-engine/sdk
```

Для серверного использования нужен Node.js 20 или новее.

## Простой пример

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const media = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await media.search({ title: "Интерстеллар" });
const details = await media.getDetails({ imdb: "tt0816692" });
```

У клиента есть методы для всего публичного API:

- `search()`;
- `getDetails()`;
- `getAvailability()`;
- `discoverTorrents()`;
- `getProviders()`, `getStreamingProviders()` и `getTorrentProviders()`;
- `getHealth()`, `getLiveness()` и `getReadiness()`.

Для подробностей передавайте внешний ID вместе с его типом, например
`media.getDetails({ imdb: "tt0816692" })`.

## Запросы и ошибки

Headers можно задать сразу для всего клиента или только для одного запроса. Каждый метод также
принимает `AbortSignal`:

```ts
const controller = new AbortController();

const request = media.search(
  { title: "Дюна" },
  { signal: controller.signal },
);
```

Через опцию `fetch` конструктора можно передать свою fetch-совместимую функцию. При неуспешном HTTP
ответе или неверном JSON SDK выбрасывает `MediaEngineApiError`. В ошибке по возможности сохраняются
HTTP status и тело ответа.

SDK только общается с API. Он не вызывает провайдеры напрямую, не рисует плееры и не запускает
torrent-клиент. Полный пример backend и frontend есть в
[быстром старте](https://github.com/Yaneart/media-engine/blob/main/docs/quick-start.ru.md).

## Лицензия

MIT
