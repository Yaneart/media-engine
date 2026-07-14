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
const health = await media.getHealth();
```

У клиента шесть методов:

- `search()`;
- `getDetails()`;
- `getAvailability()`;
- `getProviders()`;
- `getStreamingProviders()`;
- `getHealth()`.

Каждый метод принимает дополнительные заголовки и `AbortSignal`. При необходимости можно передать собственную совместимую реализацию `fetch`.

При неуспешном HTTP-ответе или неверных данных SDK выбрасывает `MediaEngineApiError` и по возможности сохраняет HTTP-статус и тело ответа.

SDK не вызывает провайдеры и не рисует плееры. Он только превращает типизированные методы в HTTP-запросы.

Примеры запросов есть в [описании публичного API](https://github.com/Yaneart/media-engine/blob/main/docs/public-api.md).

## Лицензия

MIT
