# Reference torrent playback

Media Engine's public packages stop at normalized torrent discovery and opaque handoff data. The
repository is developing a separate, optional reference playback path in `apps/api` that delegates
BitTorrent transport and piece caching to an independently running
[TorServer](https://github.com/YouROK/TorrServer) process.

## Component and license boundary

TorServer is a separate GPL-3.0 component. This MIT repository does not copy or fork its source,
commit its executable, or add it to the dependency graphs and tarballs of `@media-engine/core`,
`@media-engine/providers`, or `@media-engine/sdk`. Operators who later enable the reference path
remain responsible for the separately distributed TorServer component and its license terms.

The private client contract and official container were reviewed against TorServer
`MatriX.141.1`, source commit `49cef22fc02c501d844cfebe7a7c00ad0c6758f2`. Compose pins the
multi-architecture GHCR image by both that release tag and immutable index digest
`sha256:e44f08ec579615a783c3ab45e00595f50e9e5f94810dc06910c201edecd6205b`; it never follows
`latest`. The image metadata identifies the reviewed commit and release, while its `/echo` endpoint
reports the upstream binary line `MatriX.141`. Upgrading the pin requires reviewing `/echo`,
`POST /torrents`, and `/play/{hash}/{fileId}` again, resolving and recording the new registry
digest, and rerunning the contract and Compose checks.

## Current implementation boundary

The private TorServer client lives under `apps/api/src/reference-playback/torrserver`. It provides:

- an exact operator-owned HTTP(S) base URL with optional paired Basic credentials;
- separate response-start, complete-request, and metadata-poll timeout budgets;
- bounded request concurrency, response bytes, file count, path length, and file size;
- health, add, get, bounded metadata polling, drop, and controlled play-target construction;
- strict status/file parsing, cancellation, redirect rejection, and redacted typed errors.

The response-start budget covers DNS, connection establishment, and receipt of response headers;
the complete-request budget remains active while the bounded body is read. Credentials, magnets,
upstream response bodies, and configured targets are not copied into client errors.

The API application now also owns a private bounded candidate catalog and session lifecycle:

- successful `GET /media/torrents` responses copy candidates into a fresh-only, process-local
  catalog keyed by exact provider and candidate ID; the default cap is 500 entries and the default
  TTL is five minutes or the candidate's earlier advertised expiry;
- session creation resolves only that server-owned copy, revalidates provider/ID, handoff/info-hash
  agreement, handoff kind, expiry, and optional server-offered file ID, and never accepts a handoff,
  hash, path, or TorServer target from a caller. Magnet handoffs remain supported; an HTTPS
  torrent-file handoff is accepted only for the exact catalog-owned YTS URL whose path contains the
  expected info hash, and TorServer's returned hash is checked again;
- TorServer add/metadata work is bounded by total/concurrent-start limits and high-entropy session
  IDs. Identical info hashes share preparation and use reference counting; the final stop, expiry,
  cancellation, or application shutdown performs one best-effort `drop`;
- sanitized video files are selected automatically only for an unambiguous movie or requested
  episode. Ambiguous metadata produces `file_selection_required` with a bounded safe list;
- exact bounded inspection can run in the private container-native worker after server-owned file
  selection and before ready/conversion state. The API sends only hash/file ID and bounded file
  metadata; the worker constructs the HTTP(S) TorServer target and accepts no caller URL. It has no
  host port, repository mount, or application secrets, while its no-shell `ffprobe` subprocess
  rejects redirects and has fixed CPU/allocation/probe/output/time bounds. Native hosts retain an
  exclusive reviewed-path fallback. Inspection retries one timeout; only a catalog-owned YTS
  torrent-file candidate already identified as an H.264/x264 MP4 may retain its conservative direct
  classification after both attempts time out. MKV, HEVC/x265, unknown codecs, arbitrary URLs, and
  other providers cannot use this fallback. Other probe failures are explicit and release the
  torrent resource;
- exact browser-compatible primary tracks in MKV/MOV/TS and other non-browser containers can be
  remuxed asynchronously by the same private worker into MP4, WebM, or OGG without video
  re-encoding. The worker accepts only the server-owned hash/file ID, target container, and bounded
  file metadata; FFmpeg runs without a shell, credentials, redirects, or non-HTTP input. Separate
  job concurrency, duration, per-output, total-storage-reservation, and output-TTL limits apply;
- states are `starting`, `file_selection_required`, `ready`, `conversion_required`, `failed`, and
  `stopped`. File classification is deliberately limited to `direct`, `remux_required`,
  `transcode_required`, or `unknown`; it describes reference-path preparation and is not a promise
  that a particular browser supports the codecs. Known H.265/HEVC/x265 and H.266/VVC files are
  classified conservatively as transcode-required even inside MP4 because native support is not a
  portable browser baseline;
- every session snapshot contains an expiring high-entropy `streamUrl`, usable only while a file is
  selected and the session is ready. The API resolves either its TorServer
  `/play/{hash}/{fileId}` target or a completed private worker output exclusively from server-owned
  session state, permits this capability route to load from a separate frontend origin, and
  streams the response with backpressure instead of buffering media in memory. TorServer Basic
  credentials are never forwarded to the worker output;
- the stream gateway accepts `GET` and `HEAD`, normalizes exactly one satisfiable byte range,
  forwards only `Range` and bounded cache validators, rejects redirects and inconsistent upstream
  status/length/range headers, and returns only a small safe set of media/cache headers. Opening a
  stream has its own 30-second response-header budget, independent from the 15-second TorServer
  control connection timeout. One transient transport or 5xx failure may be retried before any
  response bytes, without resetting that budget;
- browser and session cancellation abort upstream work. Eight simultaneous response bodies and a
  30-second body-idle timeout are the defaults; excess streams fail immediately rather than queue.

The default private limits are a 500-entry/five-minute candidate catalog, eight total sessions,
two concurrent starts, a 120-second start budget, a 30-minute session TTL, at most 100 offered
files, eight active streams, a 30-second stream-header timeout, and a 30-second stream-idle timeout.
TorServer control requests use separate 15-second connection, 40-second complete-request,
60-second metadata, and 250-millisecond poll defaults. One transient preparation failure is retried
inside the same session-start budget.
Remux defaults are one active job, a ten-minute worker budget, an eight-GiB output cap, a
sixteen-GiB total storage reservation, and a 30-minute output TTL.
Their strict
`MEDIA_ENGINE_TORRENT_CANDIDATE_*` and
`MEDIA_ENGINE_TORRENT_PLAYBACK_*` settings are listed in `.env.example`; they do not enable a
playback route or TorServer process.

The repository API now exposes the app-specific session lifecycle through:

```text
GET /reference/torrent-playback/health
POST /reference/torrent-playback/sessions
GET /reference/torrent-playback/sessions/:id
DELETE /reference/torrent-playback/sessions/:id
GET|HEAD /reference/torrent-playback/sessions/:id/stream
```

Playback stays disabled unless `MEDIA_ENGINE_TORRSERVER_URL` and a separate 32-512 character
`MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN` are configured together. Create, status, and stop require the
token as an Authorization Bearer secret. The server compares a fixed-size digest, never returns the
token, and does not add it to the SDK or frontend. Those lifecycle routes have a separate strict
process-local rate limit (10 requests per minute by default) and expose no global session list.

The stream route deliberately cannot require an Authorization header because native browser media
elements cannot attach the operator Bearer secret. Instead, the 256-bit random session ID is a
short-lived capability embedded in `streamUrl`; it expires, stops working when the session is
stopped, and must be treated as a secret. Do not persist it, include it in analytics, or place it in
cross-origin links. Responses use `Cache-Control: private, no-store`. Stream traffic is excluded
from the lifecycle request counter because browser seeking may open several ranges; its independent
active-stream and idle-time bounds protect the backend.

The public reference health probe is rate-limited but does not require the playback token. It
returns only `disabled`, `ok`, or `unavailable` plus the healthy TorServer version and remains
separate from mandatory Media Engine readiness. A TorServer outage therefore does not degrade
`/health/ready`.

## Opt-in Docker profile

Default `docker compose up` starts only the API and example. To use the reviewed repository-managed
TorServer, copy `.env.example` to `.env`, generate a dedicated token with
`openssl rand -base64 32`, and set:

```dotenv
MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090
MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN=<generated-operator-secret>
MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL=http://torrent-media-worker:8080
```

Then start the explicit profile:

```bash
docker compose --profile torrent-playback up --build
```

The TorServer and media-worker containers have no `ports` mapping. Only the API and worker join the
dedicated Compose network; the example remains on the default network. Both containers use
read-only root filesystems, drop Linux capabilities, prevent privilege escalation, rotate bounded
logs, and have explicit RAM, CPU, and PID limits. TorServer writable config, torrent-autoload, and
`/tmp` paths are bounded ephemeral tmpfs mounts. The worker uses a dedicated writable volume only
for bounded remux outputs; it deletes recognized orphan outputs at startup and enforces its logical
per-output/total reservation independently of the volume. TorServer itself runs in
read-only-settings mode, which keeps its upstream
in-memory piece cache at the reviewed 64 MiB default and prevents runtime settings mutation.
Restarting the container intentionally discards its config/database and autoload scratch; Media
Engine adds candidates with `save_to_db: false` and owns the bounded session lifecycle.

The bundled service does not enable TorServer Basic Auth. It is not reachable from the host or the
example network, and the exposed Media Engine create/status/stop routes require their independent
operator Bearer token. This is safer than automatically enabling the upstream flag: TorServer
silently skips its auth middleware when `accs.db` is absent or unreadable. An operator-managed
external TorServer may enable upstream Basic Auth explicitly; configure its exact URL and paired
`MEDIA_ENGINE_TORRSERVER_USERNAME`/`MEDIA_ENGINE_TORRSERVER_PASSWORD` in the API environment. A
host-local instance is reachable from repository Compose as `http://host.docker.internal:8090`.
Keep any external instance on a firewall-restricted private path: in the reviewed release, upstream
Basic Auth covers management endpoints but the media `/play` routes are registered outside that
authenticated route group.

The example app now provides an opt-in native browser player flow. Its Vite dev/preview server is a
narrow same-origin lifecycle BFF that injects the operator Bearer token from server-only environment
state. The token is never compiled into the frontend or persisted by the browser; native media uses
only the expiring `streamUrl`. Direct files expose playback, seeking, buffering diagnostics, manual
status refresh, and explicit cleanup. Ambiguous torrents expose bounded file selection.

Browser-compatible files in non-browser containers now enter asynchronous remux, remain `starting`
while FFmpeg stream-copies them, and become `ready` with `playbackMode: remux` when the bounded
output is complete. The example polls this transition and then uses the same `streamUrl`.
Transcode-required files remain an honest visible `conversion_required` state and are never
attached to the browser player. `GET /media/torrents` itself remains discovery-only. A static
production deployment must implement an equivalent authenticated BFF or leave reference playback
disabled.

## Русский

Публичные пакеты Media Engine заканчиваются на нормализованном поиске torrent-кандидатов и opaque
handoff. Опциональный reference playback будет использовать отдельно запущенный TorServer как
внешний GPL-3.0 компонент; его исходный код, бинарник и container layers не входят в этот MIT
репозиторий и публичные npm-пакеты.

Приватный слой фиксирует ограниченный контракт TorServer `MatriX.141.1`: operator-owned URL, парные
Basic credentials, timeout/concurrency/resource limits, health/add/get/poll/drop и
server-controlled play target. API теперь также хранит короткоживущую bounded-копию кандидатов,
возвращённых `GET /media/torrents`, и строит приватные playback-сессии только по точным
`provider + candidateId` и опциональному server-offered `fileId`. Перед TorServer повторно
проверяются handoff/info hash, identity и expiry; magnet остаётся разрешён, а torrent-file URL
принимается только для server-owned кандидата YTS с ожидаемым hash в строгом HTTPS path. Hash,
который вернул TorServer, проверяется ещё раз; одинаковые hash используют общую
подготовку и refcount до финального cleanup.

Неоднозначный набор файлов возвращает `file_selection_required`; состояния conversion и
совместимость direct/remux/transcode/unknown не обещают поддержку конкретным браузером. Известные
H.265/HEVC/x265 и H.266/VVC консервативно требуют transcode даже в MP4, поскольку их нативная
поддержка не является переносимым browser baseline.

Точная bounded inspection теперь может выполняться в приватном container-native worker после
server-owned выбора файла и до ready/conversion state. API передаёт только hash/file ID и bounded
метаданные файла; worker сам строит HTTP(S) TorServer target и не принимает caller URL. У него нет
host port, mount репозитория или секретов приложения, а no-shell `ffprobe` ограничен по
CPU/allocation/probe/output/time и запрещает redirects. Для native host остаётся взаимоисключающий
fallback с проверенным абсолютным путём. Timeout inspection повторяется один раз. Только
catalog-owned YTS torrent-file с уже определённым H.264/x264 MP4 может сохранить консервативный
direct-режим после двух timeout; для MKV, HEVC/x265, неизвестного codec, произвольного URL и других
providers этот fallback запрещён. Остальные ошибки явно завершают сессию и освобождают torrent
resource.

Browser-compatible primary tracks в MKV/MOV/TS и других неподходящих container теперь могут
асинхронно stream-copy remux-иться тем же приватным worker в MP4, WebM или OGG без перекодирования
видео. Worker принимает только server-owned hash/file ID, целевой container и bounded metadata;
FFmpeg не получает shell, credentials, redirects или non-HTTP input. Отдельно ограничены
concurrency, duration, размер одного результата, суммарная storage reservation и output TTL.

App-specific routes create/status/stop теперь доступны только при совместной настройке точного
`MEDIA_ENGINE_TORRSERVER_URL` и отдельного `MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN` длиной 32-512
символов. Токен передаётся как Bearer, сравнивается через fixed-size digest, не возвращается API и
не входит в SDK/frontend. Отдельный строгий rate limit по умолчанию разрешает 10 playback-запросов
в минуту; глобального списка сессий нет. Публичный playback health сообщает только
disabled/ok/unavailable и не влияет на основную `/health/ready`.

Сессия с выбранным файлом возвращает короткоживущий `streamUrl` для `GET`/`HEAD`. Его случайный
256-битный ID служит capability, потому что нативный browser media element не умеет добавлять
операторский Bearer token. URL нужно считать секретом: не сохранять, не отправлять в аналитику и не
передавать посторонним клиентам. Stream route явно разрешает загрузку из отдельного frontend origin;
после expiry или stop URL перестаёт работать. Gateway разрешает только один
валидный byte range, безопасные cache validators и ограниченный набор response headers; redirect и
несогласованные 200/206/304/416 отклоняются. Поток идёт с backpressure без полной буферизации.
Ожидание media headers имеет отдельный общий бюджет 30 с и не использует 15-секундный control
connect timeout. До отправки response bytes допускается не более одного повтора transient
transport/5xx-сбоя без сброса общего бюджета. Disconnect отменяет upstream и не запускает повтор.
По умолчанию разрешено восемь активных потоков с body idle timeout 30 с.

Обычный `docker compose up` TorServer не запускает. После настройки
`MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090`, worker URL и отдельного playback token
официальный image и worker можно явно включить командой
`docker compose --profile torrent-playback up --build`. Релиз
`MatriX.141.1` закреплён одновременно tag и immutable digest; host port отсутствует, а отдельную
Compose-сеть с сервисом разделяет только API. Read-only rootfs/settings, bounded ephemeral tmpfs,
ротация логов и лимиты RAM/CPU/PID удерживают deployment в заданных границах; upstream memory
cache остаётся на проверенном default 64 MiB.

Во встроенном профиле Basic Auth TorServer не включён: сервис изолирован сетью, а внешние
create/status/stop уже требуют независимый Bearer token. Для operator-managed внешнего TorServer
можно явно передать URL и парные Basic credentials; host-local экземпляр доступен из Compose как
`http://host.docker.internal:8090`. Внешний экземпляр должен оставаться за firewall в приватной
сети: у проверенного релиза Basic Auth защищает management endpoints, но `/play` зарегистрирован
вне authenticated route group. Example теперь содержит опциональный нативный player flow: Vite
dev/preview server добавляет операторский token только на server-side lifecycle BFF, а браузер
получает лишь временный `streamUrl`. Direct-файлы поддерживают seek/buffering diagnostics и явный
cleanup; неоднозначные torrents предлагают ограниченный выбор файла. Совместимый remux остаётся в
`starting`, затем переходит в `ready` с `playbackMode: remux` и воспроизводится через тот же
`streamUrl`. Transcode ещё не реализован, поэтому `conversion_required` честно показывается и не
подключается к `<video>`.
Magnet, target URL и file path от браузера не принимаются. Статическому production deployment нужен
эквивалентный authenticated BFF, иначе player должен остаться выключенным. Переход на другую версию
TorServer требует повторной проверки контракта и нового immutable digest.
