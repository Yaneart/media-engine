# Media Engine API

[English](https://github.com/Yaneart/media-engine/blob/main/apps/api/README.md) | **Русский**

Готовая NestJS-обертка над Media Engine. Полезна, когда браузеру или другому сервису нужен HTTP-доступ к движку.

Это приложение относится к GitHub-репозиторию и не публикуется как npm-пакет.

## Запуск

Из корня репозитория:

```bash
pnpm install
pnpm dev:api
```

API запускается на <http://127.0.0.1:3000>. Swagger доступен на <http://127.0.0.1:3000/docs>.

Пример запроса:

```bash
curl 'http://127.0.0.1:3000/media/search?title=Interstellar&language=en'
```

## Маршруты

```text
GET /health
GET /health/live
GET /health/ready
GET /providers
GET /providers/streaming
GET /providers/torrent
GET /media/search
GET /media/details
GET /media/availability
GET /media/torrents
POST /media/torrent-sessions
GET /media/torrent-sessions/:id
POST /media/torrent-sessions/:id/selection
DELETE /media/torrent-sessions/:id
GET /media/torrent-streams/:capability
HEAD /media/torrent-streams/:capability
GET /docs
GET /docs-json
```

`GET /media/details` требует namespaced external ID, например `imdb`, `kinopoisk` или `ids.shikimori`. Простой `id` неоднозначен между провайдерами и возвращает HTTP 400.

Все media endpoints нормализуют пробелы, ID и язык до provider/cache работы; эквивалентные top-level и `ids.*` формы используют один cache key. Некорректные известные ID и слишком большие поля возвращают HTTP 400. `GET /media/search?...&limit=0` является намеренным zero-work probe и возвращает пустой provider-free ответ.

Отключение HTTP-запроса передается в core как abort signal. Если другой идентичный HTTP-запрос еще подписан на ту же работу, provider work продолжается; иначе queued/running provider work отменяется, а брошенный ответ не кешируется.

Локальные настройки читаются из `.env`. Основные значения описаны в корневом `.env.example`, включая порт и тайм-ауты провайдеров. Metadata, generic streaming и FlixHQ используют независимые бюджеты времени. В default streaming-набор входят KinoBD, FlixHQ, DDBB и AniLiberty; ни один из них не требует credentials вызывающей стороны.

Torrent discovery по умолчанию выключен. В `MEDIA_ENGINE_TORRENT_PROVIDERS` задается явное comma-separated подмножество `yts-torrent`, `jacred-torrent`, `bitsearch-torrent` и `magnetz-torrent`, а его ограниченный request budget настраивается через `MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS`. `GET /media/torrents` принимает один canonical `title` и повторяемые ограниченные `alternativeTitles`, чтобы региональный каталог мог использовать известное локализованное название без смены media identity. Маршрут возвращает только нормализованные candidates и непрозрачный handoff: он не подключается к swarm, не выбирает файлы и не стримит media. `GET /providers/torrent` сообщает настроенные discovery providers и их безопасные optional display/scope/locale catalog metadata. Candidate от meta-indexer может сохранять конкретный `catalogSource`; locale каталога не гарантирует язык аудиодорожки релиза.

App-specific original-file runtime отделён от discovery. `docker compose up -d` запускает release `MatriX.141.1` по закреплённому digest без host port вместе с API и example. TorrServer использует private control network с API и отдельную outbound network для trackers, DHT и peers. Internal adapter требует его точную `/echo` wire-version `MatriX.141`, принимает только hash-bound magnets или уже разрешённые ограниченные `.torrent` bytes и реализует health, add, metadata, exact-file target и drop.

`MEDIA_ENGINE_TORRSERVER_OWNER_ID` должен быть стабильным и уникальным для каждого API deployment, использующего общий TorrServer. При startup удаляются только устаревшие записи с точным owner marker этого deployment; существующие записи заимствуются и никогда не удаляются. Timestamped ownership lease проверяется перед selection и каждым stream access, поэтому restart TorrServer или замена записи аннулирует устаревшую capability.

Session routes принимают ограниченную media query и только точные `provider`/opaque candidate `id`. API повторно разрешает observation, при необходимости загружает provider-owned `.torrent` с жёсткими size/time/redirect ограничениями и не принимает browser-controlled magnet, hash, upstream URL, path или TorrServer target. Session states: `adding`, `waiting_metadata`, `selection_required`, `ready`, `failed`, `stopped`, `expired`. Все обычные non-padding файлы предлагаются независимо от расширения; неоднозначный torrent требует один предложенный numeric file ID. Sessions с одинаковым hash совместно используют подготовку TorrServer, а последний stop/expiry/shutdown освобождает запись.

Все create/status/select/stop routes требуют `Authorization: Bearer <MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN>`. Example browser не получает этот token: lifecycle-вызовы аутентифицирует same-origin server-side BFF. Для `GET`/`HEAD` media bytes единственным credential остаётся high-entropy stream capability.

Snapshot в состоянии `ready` содержит expiring high-entropy `streamUrl`, но не upstream target. Его `GET`/`HEAD` route отдаёт точные выбранные original bytes, принимает один closed/open/suffix Range, возвращает строгие `200`/`206`/`416` metadata, пропускает только безопасные validators и стримит с backpressure. Capability route явно разрешает cross-origin media embedding, чтобы отдельно запущенный example frontend мог его использовать; script access остаётся ограничен configured CORS allowlist. Отключение клиента, stop/expiry session, header deadline и inactivity body отменяют upstream work. Исправный original stream всё ещё не обещает поддержку codec браузером.

Session lifetime, retention terminal-записей, cleanup cadence и timeout загрузки torrent-file ограничены настройками `MEDIA_ENGINE_TORRENT_SESSION_TTL_MS`, `MEDIA_ENGINE_TORRENT_SESSION_TERMINAL_RETENTION_MS`, `MEDIA_ENGINE_TORRENT_SESSION_CLEANUP_INTERVAL_MS` и `MEDIA_ENGINE_TORRENT_SOURCE_REQUEST_TIMEOUT_MS`. По умолчанию session живёт шесть часов, чтобы защищённой original stream-ссылки хватило на полнометражный фильм. `MEDIA_ENGINE_TORRENT_SESSION_MAX_CONCURRENT_CREATIONS` и `MEDIA_ENGINE_TORRENT_STREAM_MAX_CONCURRENT` ограничивают process-local creation work и активные original streams; исчерпание capacity возвращает типизированный `503`, не инвалидируя исправную stream capability.

Original-torrent операции записывают JSON structured logs с component `original_torrent` и scope `runtime`, `session` или `stream`. Allowlist содержит duration операций и metadata, ожидание upstream headers и первого body byte, full/partial Range offsets, success/failure/cancellation, количество активных sessions/creations/streams, resources/references, ownership class, file count и cleanup. Capability/session IDs, info hashes, magnets, torrent payloads, titles и file paths, internal URLs, credentials и исходные тексты ошибок не логируются. Сбой telemetry sink не влияет на control и streaming behavior.

`/health/live` проверяет только способность API-процесса отвечать HTTP. `/health/ready` и обратно совместимый `/health` также проверяют provider circuits и возвращают `status: "degraded"`, если хотя бы один circuit открыт или восстанавливается. Degraded readiness остается HTTP 200, потому что API все еще может отдавать частичные результаты.

Deployment-настройки строго разбираются при старте. `HOST` должен быть IP-адресом или hostname, `PORT` - целым числом от 1 до 65535, а production требует явный comma-separated allowlist `CORS_ORIGINS` с точными HTTP(S) origins. Дорогие media endpoints используют общий process-local fixed-window limit через `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` и `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; ставьте максимум `0` только при наличии эквивалентного edge limiter. Создание sessions имеет отдельный per-client fixed-window budget через `MEDIA_ENGINE_TORRENT_SESSION_CREATION_RATE_LIMIT_WINDOW_MS` и `MEDIA_ENGINE_TORRENT_SESSION_CREATION_RATE_LIMIT_MAX_REQUESTS`. Он применяется только к точному create-запросу; status, selection и Stop им не ограничиваются.

Helmet применяет no-content CSP и стандартные security headers к JSON API. Swagger имеет отдельную self-only policy, разрешающую его inline bootstrap. Example/player UI - отдельная deployment surface: держите third-party embeds выключенными или задавайте явный `frame-src` allowlist там, а не ослабляйте API CSP.

Development Compose по умолчанию публикует API и example ports на всех интерфейсах, что может открыть их в локальную сеть. Для loopback-only доступа задайте `MEDIA_ENGINE_COMPOSE_BIND_ADDRESS=127.0.0.1` в `.env` до `docker compose up`.

## Проверка

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
# При запущенном Compose stack и уже собранном API:
docker compose exec -T api node scripts/original-torrent-range-smoke.mjs
# При установленном Firefox на host:
pnpm smoke:torrent-browser
```

Provider-код находится в `@media-engine/providers`, merging - в `@media-engine/core`. Это приложение только подключает их к HTTP и не раскрывает secrets в ответах.

## Лицензия

MIT
