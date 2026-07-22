# @media-engine/sdk

[English](https://github.com/Yaneart/media-engine/blob/main/packages/sdk/README.md) | **Русский**

Типизированный `fetch`-клиент для REST API Media Engine.

Он нужен, когда браузер, бот или другой сервис обращается к `apps/api`, а не создаёт `MediaEngine` напрямую.

```bash
npm install @media-engine/sdk
```

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const media = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await media.search({ title: "Интерстеллар" });
const details = await media.getDetails({ imdb: "tt0816692" });
const torrents = await media.discoverTorrents({ type: "movie", imdb: "tt0816692" });
const health = await media.getHealth();
const live = await media.getLiveness();
const ready = await media.getReadiness();
```

В `getDetails()` передавайте внешний ID с указанием источника — через `ids` или сокращение вроде `imdb`. API отклоняет устаревший запрос с одним обычным `id` и возвращает HTTP 400.

Основные методы клиента:

- `search()`;
- `getDetails()`;
- `getAvailability()`;
- `discoverTorrents()`;
- `getProviders()`;
- `getStreamingProviders()`;
- `getTorrentProviders()`;
- `getHealth()`.

Каждый метод принимает дополнительные заголовки и `AbortSignal`. При необходимости можно передать собственную совместимую реализацию `fetch`.

При неуспешном HTTP-ответе или неверных данных SDK выбрасывает `MediaEngineApiError` и по возможности сохраняет HTTP-статус и тело ответа.

SDK не вызывает провайдеры, не рисует плееры и не запускает torrent-клиент. Он только превращает типизированные методы в HTTP-запросы.

Примеры запросов есть в [описании публичного API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md).

## Лицензия

MIT
