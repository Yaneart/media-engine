# Media Engine

[English](README.md) | **Русский**

Найти информацию о фильме несложно. Сложность начинается, когда каждый источник по-своему пишет названия, использует свои ID и иногда просто перестаёт отвечать.

Media Engine прячет эти различия за одним TypeScript API. Вы просите найти фильм, сериал или аниме, а движок сам обращается к подходящим источникам, объединяет совпадения и честно сообщает, если часть данных получить не удалось.

Версия `0.1.1` опубликована в npm.

## Попробовать

Понадобится Node.js 20 или новее.

```bash
npm install @media-engine/core @media-engine/providers
```

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tvMazeProvider,
  wikidataProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
    tvMazeProvider(),
    wikidataProvider(),
  ],
});

const result = await media.search({
  title: "Интерстеллар",
  language: "ru",
});

console.log(result.results[0]?.item);
```

Искать можно и по внешнему ID:

```ts
const result = await media.search({ imdb: "tt0816692" });
```

Для встроенных провайдеров не нужны API-ключи, приватные токены или cookie аккаунта.

## Что входит в проект

- [`@media-engine/core`](https://www.npmjs.com/package/@media-engine/core) — движок и публичные типы;
- [`@media-engine/providers`](https://www.npmjs.com/package/@media-engine/providers) — готовые источники метаданных и плееров;
- [`@media-engine/sdk`](https://www.npmjs.com/package/@media-engine/sdk) — типизированный клиент для REST API;
- `apps/api` — запускаемый API на NestJS;
- `apps/example` — небольшой пример на React.

Поиск метаданных и поиск плееров разделены. Можно использовать Media Engine только для названий, постеров и описаний, а стриминговые провайдеры подключить позже, если приложению понадобятся варианты плееров.

## Посмотреть в браузере

```bash
pnpm install
pnpm dev:compose
```

После запуска откройте <http://127.0.0.1:5173>. API будет доступен на <http://127.0.0.1:3000>, а Swagger — на <http://127.0.0.1:3000/docs>.

## Небольшое, но важное предупреждение

Media Engine работает с публичными сторонними источниками. Они могут отвечать медленно, временно не работать или неожиданно изменить формат. Движок ограничивает последствия таких сбоев и по возможности возвращает частичный результат, но не может обещать вечную работу каждого источника или плеера.

Media Engine не хранит видео. Он только приводит метаданные и сторонние варианты плееров к удобному для приложения виду.

## Узнать больше

В [индексе документации](docs/README.md) есть ссылки на архитектуру, API, модель данных, провайдеры и roadmap. Настройки отдельных пакетов находятся в их README, чтобы не повторять всё на этой странице.

Локальные проверки:

```bash
pnpm release:check
pnpm pack:check
```

## Лицензия

MIT
