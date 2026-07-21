# Media Engine API

[English](https://github.com/Yaneart/media-engine/blob/main/apps/api/README.md) | **Русский**

Готовая NestJS-обёртка над Media Engine. Она пригодится, когда браузеру или другому сервису нужен доступ к движку по HTTP.

Приложение входит в GitHub-репозиторий и не является npm-пакетом.

## Запуск

Из корня репозитория:

```bash
pnpm install
pnpm dev:api
```

API запустится на <http://127.0.0.1:3000>. Swagger находится на <http://127.0.0.1:3000/docs>.

Пример запроса:

```bash
curl 'http://127.0.0.1:3000/media/search?title=Интерстеллар&language=ru'
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

Для `GET /media/details` нужен внешний ID с указанием источника, например `imdb`, `kinopoisk` или `ids.shikimori`. Обычный `id` неоднозначен между провайдерами, поэтому API возвращает HTTP 400.

Все media endpoints приводят ID и language к canonical-виду до обращения к провайдерам/cache; эквивалентные top-level и `ids.*` формы используют один cache key. Некорректные известные ID и слишком длинные поля возвращают HTTP 400. `GET /media/search?...&limit=0` — намеренный zero-work probe с пустым ответом без вызова провайдеров.

Disconnect media-запроса передается в core как abort signal. Если на тот же запрос еще подписан другой HTTP caller, общая provider operation продолжает работу; иначе queued/running provider work отменяется, а брошенный ответ не кешируется.

Локальные настройки читаются из `.env`. Основные значения, включая порт и тайм-ауты провайдеров, перечислены в корневом `.env.example`. Metadata, KinoBD streaming и FlixHQ используют независимые бюджеты времени; увеличенный тайм-аут FlixHQ не обрезается более коротким общим streaming timeout.

`/health/live` проверяет только способность процесса API отвечать на HTTP-запросы. `/health/ready` и обратно совместимый `/health` дополнительно проверяют circuits провайдеров и возвращают `status: "degraded"`, если хотя бы один circuit открыт или восстанавливается. Degraded readiness остаётся HTTP 200, поскольку API всё ещё может отдавать частичные результаты.

Deployment-настройки строго проверяются при запуске. `HOST` должен быть IP-адресом или hostname, `PORT` — целым числом от 1 до 65535, а production требует явный список `CORS_ORIGINS` из точных HTTP(S) origins через запятую. Три дорогих media endpoint используют общий process-local fixed-window limit, настраиваемый через `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` и `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; значение `0` стоит использовать только при наличии эквивалентного edge limiter.

Helmet добавляет стандартные security headers и запрещающую content CSP для JSON API. Swagger получает отдельную self-only policy с необходимым inline bootstrap. Example/player UI разворачивается отдельно: для него следует отключить сторонние embeds или задать явный `frame-src` allowlist, а не ослаблять CSP API.

Development Compose по умолчанию публикует порты API и example на всех интерфейсах, поэтому они могут быть доступны в локальной сети. Для доступа только через loopback задайте `MEDIA_ENGINE_COMPOSE_BIND_ADDRESS=127.0.0.1` в `.env` перед `docker compose up`.

## Проверки

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Код провайдеров находится в `@media-engine/providers`, а объединение данных — в `@media-engine/core`. Это приложение только связывает их с HTTP и не выпускает секреты наружу.

## Лицензия

MIT
