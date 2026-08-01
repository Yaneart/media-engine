# Media Engine

[English](README.md) | **Русский**

Найти информацию о фильме несложно. Сложность начинается, когда каждый источник по-своему пишет названия, использует свои ID и иногда просто перестаёт отвечать.

Media Engine прячет эти различия за одним TypeScript API. Вы просите найти фильм, сериал или аниме, а движок сам обращается к подходящим источникам, объединяет совпадения и честно сообщает, если часть данных получить не удалось.

Версия `0.1.1` опубликована в npm.

Версии пакетов, API-контракта и User-Agent имеют разный смысл; детали описаны в
[контракте версий и сборки пакетов](./docs/versioning.md).

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

Создаёте browser application? В [быстром старте для новичка](docs/quick-start.ru.md) показано, как
собрать минимальный backend на NestJS и вызвать его из frontend через `@media-engine/sdk`.

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

В default Compose stack входит отдельно лицензируемый, закреплённый и не публикуемый TorrServer runtime.
Задайте в `.env` случайный `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN` длиной от 32 символов, затем
запустите весь stack:

```bash
docker compose up -d
```

TorrServer не публикует host port. Он использует private API network и отдельную outbound network для
trackers, DHT и peers. Application layer создаёт expiring server-owned sessions
из точного discovery observation, объединяет sessions с одинаковым info hash, показывает все
non-padding файлы без фильтрации расширений, проверяет выбранный numeric file ID и очищает runtime
при stop, expiry или shutdown API. API не принимает raw magnet, hash, upstream URL, path или
TorrServer target.
Стабильный и уникальный для deployment `MEDIA_ENGINE_TORRSERVER_OWNER_ID` помечает только записи,
созданные этим API. При startup удаляются его старые помеченные записи, а уже существующие
непомеченные записи используются без последующего удаления. Timestamped ownership lease аннулирует
устаревшую stream capability при restart TorrServer или замене записи; несовместимая закреплённая
версия runtime останавливает startup API.
Готовая session раскрывает только high-entropy application capability. Её защищённый `GET`/`HEAD`
route стримит точный выбранный original file со строгим single-range,
backpressure, cancellation, ограниченными cold-start timeout и active-stream concurrency, не
раскрывая TorrServer. Создание sessions также ограничено по concurrency и отдельным per-client
budget, который не затрагивает status, selection и Stop. Example
использует server-authenticated same-origin BFF для lifecycle calls и один нативный `<video>` для
original capability. Он различает metadata wait и first-piece buffering, а отказ браузера сообщает
как `client_format_unsupported`. Media worker, probe, remux, transcode и HLS отсутствуют.
Структурированные server logs содержат только ограниченные operational fields: latency metadata и
upstream wait, first-byte timing, Range offsets, cancellation/outcome, active counts, shared
references и cleanup. В них не попадают capabilities, hashes, magnets, torrent bytes, имена файлов,
internal URLs, credentials или исходные тексты ошибок.

## Небольшое, но важное предупреждение

Media Engine работает с публичными сторонними источниками. Они могут отвечать медленно, временно не работать или неожиданно изменить формат. Движок ограничивает последствия таких сбоев и по возможности возвращает частичный результат, но не может обещать вечную работу каждого источника или плеера.

Media Engine не хранит видео. Он только приводит метаданные и сторонние варианты плееров к удобному для приложения виду.

## Узнать больше

В [индексе документации](docs/README.md) есть ссылки на архитектуру, API, модель данных, провайдеры и roadmap. Настройки отдельных пакетов находятся в их README, чтобы не повторять всё на этой странице.

Локальные проверки:

```bash
pnpm release:check
pnpm coverage
pnpm pack:check
pnpm smoke:search-quality:scheduled
# Требует запущенный Compose stack и Firefox на host:
pnpm smoke:torrent-browser
```

`release:check` — полный локальный gate релиз-кандидата: форматирование, lint без изменения
файлов, чистая сборка, typecheck, unit coverage с порогами, API e2e, согласованность версий и
проверка dry-pack. Для встроенных coverage-фильтров и порогов нужен Node.js 22.8 или новее;
опубликованные пакеты сохраняют заявленную runtime-поддержку Node.js 20.

Push и pull request запускают детерминированный gate на Node.js 24 и 26, а публичные пакеты
отдельно проверяются на минимальной ветке Node.js 20. Live-проверки провайдеров не входят в
обязательный PR gate: для них есть scheduled/manual workflow с классификацией результатов и
явным бюджетом предупреждений. Подробности — в документе
[quality gates and live smoke policy](docs/quality-gates.md).

## Лицензия

MIT
