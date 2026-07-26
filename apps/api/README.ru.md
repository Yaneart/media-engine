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
GET /providers/torrent
GET /media/search
GET /media/details
GET /media/availability
GET /media/torrents
GET /reference/torrent-playback/health
POST /reference/torrent-playback/sessions
GET /reference/torrent-playback/sessions/:id
DELETE /reference/torrent-playback/sessions/:id
GET|HEAD /reference/torrent-playback/sessions/:id/stream
GET /docs
GET /docs-json
```

Для `GET /media/details` нужен внешний ID с указанием источника, например `imdb`, `kinopoisk` или `ids.shikimori`. Обычный `id` неоднозначен между провайдерами, поэтому API возвращает HTTP 400.

Все media endpoints приводят ID и language к canonical-виду до обращения к провайдерам/cache; эквивалентные top-level и `ids.*` формы используют один cache key. Некорректные известные ID и слишком длинные поля возвращают HTTP 400. `GET /media/search?...&limit=0` — намеренный zero-work probe с пустым ответом без вызова провайдеров.

`GET /media/torrents` только ищет кандидаты и возвращает handoff. Он не запускает torrent-клиент, не
подключается к swarm, не загружает и не хранит media, не проксирует трафик и не транскодирует видео.
По умолчанию torrent-провайдеры выключены. Нужное подмножество включается точным списком через
запятую:

```dotenv
MEDIA_ENGINE_TORRENT_PROVIDERS=yts-torrent,jacred-torrent,bitsearch-torrent,magnetz-torrent
MEDIA_ENGINE_TORRENT_PROVIDER_TIMEOUT_MS=15000
MEDIA_ENGINE_JACRED_TORRENT_PROVIDER_TIMEOUT_MS=20000
```

Поддерживаемые имена: `yts-torrent`, `jacred-torrent`, `bitsearch-torrent` и `magnetz-torrent`.
Неизвестные, повторные или пустые элементы останавливают startup. Порядок сохраняется для
interleaving результатов. Оставляйте список пустым, если владелец deployment не принял анонимные
квоты и timeout budget источников; включение discovery не включает torrent playback.

В репозитории есть отдельный защищённый reference API TorServer поверх короткоживущего server-owned
каталога кандидатов. Он выключен, пока оператор одновременно не задаст точный URL TorServer и
отдельный высокоэнтропийный playback token:

```dotenv
MEDIA_ENGINE_TORRSERVER_URL=http://127.0.0.1:8090
MEDIA_ENGINE_TORRSERVER_USERNAME=
MEDIA_ENGINE_TORRSERVER_PASSWORD=
MEDIA_ENGINE_TORRSERVER_CONNECT_TIMEOUT_MS=15000
MEDIA_ENGINE_TORRSERVER_REQUEST_TIMEOUT_MS=40000
MEDIA_ENGINE_TORRSERVER_METADATA_TIMEOUT_MS=60000
MEDIA_ENGINE_TORRSERVER_METADATA_POLL_INTERVAL_MS=250
MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN=<generate-with-openssl-rand-base64-32>
MEDIA_ENGINE_TORRENT_PLAYBACK_START_TIMEOUT_MS=120000
MEDIA_ENGINE_TORRENT_PLAYBACK_RATE_LIMIT_WINDOW_MS=60000
MEDIA_ENGINE_TORRENT_PLAYBACK_RATE_LIMIT_MAX_REQUESTS=10
MEDIA_ENGINE_TORRENT_PLAYBACK_MAX_STREAMS=8
MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_HEADER_TIMEOUT_MS=30000
MEDIA_ENGINE_TORRENT_PLAYBACK_STREAM_IDLE_TIMEOUT_MS=30000
MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH=
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL=
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_TIMEOUT_MS=25000
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_REMUX_TIMEOUT_MS=605000
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_PROBE_TIMEOUT_MS=20000
```

Создайте токен через `openssl rand -base64 32`; не добавляйте его во frontend bundle или browser
storage. Для create/status/stop нужен `Authorization: Bearer <token>`. Эти routes принимают только
ранее возвращённые API `provider + candidateId` и опциональный server-offered `fileId`; произвольные
handoff, hash, path и TorServer target запрещены. Server-owned magnet остаётся разрешён; вариант
torrent-file принимается только для точного hash-bound HTTPS URL YTS, а результат TorServer снова
проверяется. Глобального списка сессий нет. Публичный
rate-limited health отделён от обязательной API readiness и сообщает только `disabled`, `ok` или
`unavailable`, а при успехе — версию.

Snapshot сессии содержит короткоживущий высокоэнтропийный `streamUrl`, доступный после выбора
файла. Это capability для browser media без Bearer header; считайте URL секретом, не сохраняйте и
не логируйте его. GET/HEAD gateway нормализует один Range, сохраняет backpressure, отменяет
upstream при disconnect и имеет отдельные лимиты активных потоков, 30-секундного ожидания
media headers и body idle timeout. Transient transport-сбой или TorServer 5xx получает не более
одного повтора до отправки response bytes и внутри того же media-header budget. Hash, file ID и
URL TorServer по-прежнему берутся только из server-owned состояния сессии.

В repository Compose точная media inspection включается через
`MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL=http://torrent-media-worker:8080`. Приватный worker
не имеет host port, сам строит TorServer target из API-owned hash/file ID, не принимает URL в
request и запускает `ffprobe` в отдельном read-only bounded container без mount репозитория и
секретов приложения. No-shell subprocess запрещает redirects и не-HTTP protocols и ограничен по
CPU/allocation/анализу/output с 20-секундным бюджетом; worker и API добавляют отдельные внешние
бюджеты 22/25 секунд внутри session start. Точные container, primary codecs, pixel format и
dimensions заменяют release-name эвристику до ready. Если точные дорожки совместимы с браузером,
но container не подходит, тот же worker асинхронно выполняет bounded FFmpeg stream-copy remux в
MP4, WebM или OGG. API не принимает caller URL, готовый результат доступен только через прежнюю
session capability и удаляется при stop, expiry, failure, рестарте worker или по output TTL.
Defaults: один remux, восемь GiB на результат, суммарная reservation 16 GiB и десятиминутный job
budget. Ошибка явно завершает сессию и очищает torrent resource.

Timeout media inspection повторяется один раз. Если обе попытки истекли, только catalog-owned YTS
torrent-file, уже определённый как H.264/x264 в MP4, может сохранить консервативный direct-режим.
Для MKV, HEVC/x265, неизвестного codec, произвольного URL и других providers по-прежнему требуется
точная inspection. TorServer add/metadata отдельно повторяет один transient failure.

Native host deployment вместо worker может задать проверенный абсолютный
`MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH`; одновременно разрешён только один режим. Оба режима
остаются выключенными при пустых значениях и не передают TorServer Basic Auth credentials в
`ffprobe`. Native-host fallback выполняет только inspection; автоматический remux требует URL
изолированного worker.

Для варианта под управлением репозитория задайте в `.env`
`MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090` и
`MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL=http://torrent-media-worker:8080`, затем запустите
`docker compose --profile torrent-playback up --build`. Обычный Compose не запускает TorServer и
worker.
Официальный multi-arch image `MatriX.141.1` закреплён immutable digest, не имеет host port и делит
отдельную сеть только с API. Root filesystem доступна только для чтения; config и каталог
автозагрузки torrent ограничены ephemeral tmpfs, upstream settings работают в read-only режиме с
memory cache 64 MiB, container logs ротируются, действуют лимиты CPU/RAM/PID. Для встроенного
сервиса TorServer Basic Auth намеренно не используется: он изолирован сетью, а внешний API уже
защищён отдельным playback Bearer token. Так исключается upstream-поведение, при котором включение
auth без корректного `accs.db` фактически оставляет запросы без защиты.

Уже установленный локальный или удалённый TorServer по-прежнему поддерживается через явный URL.
Из Compose для экземпляра на host используйте `http://host.docker.internal:8090`; парные
username/password задавайте только когда на нём действительно включён TorServer Basic Auth. В
этом случае repository profile запускать не нужно. Порты внешнего TorServer ограничьте firewall
только доверенным backend-трафиком: в проверенном релизе Basic Auth не охватывает media route
`/play`.

Direct и remux Range delivery уже реализованы; codec transcoding остаётся следующим отдельным
блоком. В публичный SDK эти routes не входят. Детали lifecycle, лицензионная граница,
закреплённый image и upgrade policy описаны в документе
[Reference torrent playback](../../docs/reference-torrent-playback.md).

```bash
curl 'http://127.0.0.1:3000/providers/torrent'
curl 'http://127.0.0.1:3000/media/torrents?type=movie&title=Dune&year=2021&imdb=tt1160419&limit=20'
```

Disconnect media-запроса передается в core как abort signal. Если на тот же запрос еще подписан другой HTTP caller, общая provider operation продолжает работу; иначе queued/running provider work отменяется, а брошенный ответ не кешируется.

Локальные настройки читаются из `.env`. Основные значения, включая порт и тайм-ауты провайдеров, перечислены в корневом `.env.example`. Metadata, generic streaming, FlixHQ, generic torrent discovery и JacRed используют независимые бюджеты времени; KinoBD, DDBB и AniLiberty делят ограниченный generic streaming budget, а увеличенные timeout FlixHQ и JacRed им не обрезаются. В default streaming-набор входят KinoBD, FlixHQ, DDBB и AniLiberty; ни один из них не требует credentials вызывающей стороны. Torrent discovery остаётся явно включаемым.

`/health/live` проверяет только способность процесса API отвечать на HTTP-запросы. `/health/ready` и обратно совместимый `/health` дополнительно проверяют circuits провайдеров и возвращают `status: "degraded"`, если хотя бы один circuit открыт или восстанавливается. Degraded readiness остаётся HTTP 200, поскольку API всё ещё может отдавать частичные результаты.

Deployment-настройки строго проверяются при запуске. `HOST` должен быть IP-адресом или hostname, `PORT` — целым числом от 1 до 65535, а production требует явный список `CORS_ORIGINS` из точных HTTP(S) origins через запятую. Четыре дорогих media endpoint используют общий process-local fixed-window limit, настраиваемый через `MEDIA_ENGINE_RATE_LIMIT_WINDOW_MS` и `MEDIA_ENGINE_RATE_LIMIT_MAX_REQUESTS`; значение `0` стоит использовать только при наличии эквивалентного edge limiter.

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
