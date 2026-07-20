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

## Проверки

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Код провайдеров находится в `@media-engine/providers`, а объединение данных — в `@media-engine/core`. Это приложение только связывает их с HTTP и не выпускает секреты наружу.

## Лицензия

MIT
