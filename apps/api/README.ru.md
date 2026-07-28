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
GET /media/search
GET /media/details
GET /media/availability
GET /docs
GET /docs-json
```

`GET /media/details` требует namespaced external ID, например `imdb`, `kinopoisk` или `ids.shikimori`. Простой `id` неоднозначен между провайдерами и возвращает HTTP 400.

Все media endpoints нормализуют пробелы, ID и язык до provider/cache работы; эквивалентные top-level и `ids.*` формы используют один cache key. Некорректные известные ID и слишком большие поля возвращают HTTP 400. `GET /media/search?...&limit=0` является намеренным zero-work probe и возвращает пустой provider-free ответ.

Отключение HTTP-запроса передается в core как abort signal. Если другой идентичный HTTP-запрос еще подписан на ту же работу, provider work продолжается; иначе queued/running provider work отменяется, а брошенный ответ не кешируется.

Локальные настройки читаются из `.env`. Основные значения описаны в корневом `.env.example`, включая порт и тайм-ауты провайдеров. Metadata, generic streaming и FlixHQ используют независимые бюджеты времени. В default streaming-набор входят KinoBD, FlixHQ, DDBB и AniLiberty; ни один из них не требует credentials вызывающей стороны.

`/health/live` проверяет только способность API-процесса отвечать HTTP. `/health/ready` и обратно совместимый `/health` также проверяют provider circuits и возвращают `status: "degraded"`, если хотя бы один circuit открыт или восстанавливается. Degraded readiness остается HTTP 200, потому что API все еще может отдавать частичные результаты.

Deployment-настройки строго разбираются при старте. `HOST` должен быть IP-адресом или hostname, `PORT` - целым числом от 1 до 65535, а production требует явный comma-separated allowlist `CORS_ORIGINS` с точными HTTP(S) origins. Дорогие media endpoints используют общий process-local fixed-window limit через `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` и `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; ставьте максимум `0` только при наличии эквивалентного edge limiter.

Helmet применяет no-content CSP и стандартные security headers к JSON API. Swagger имеет отдельную self-only policy, разрешающую его inline bootstrap. Example/player UI - отдельная deployment surface: держите third-party embeds выключенными или задавайте явный `frame-src` allowlist там, а не ослабляйте API CSP.

Development Compose по умолчанию публикует API и example ports на всех интерфейсах, что может открыть их в локальную сеть. Для loopback-only доступа задайте `MEDIA_ENGINE_COMPOSE_BIND_ADDRESS=127.0.0.1` в `.env` до `docker compose up`.

## Проверка

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Provider-код находится в `@media-engine/providers`, merging - в `@media-engine/core`. Это приложение только подключает их к HTTP и не раскрывает secrets в ответах.

## Лицензия

MIT
