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
- session creation resolves only that server-owned copy, revalidates provider/ID, magnet/info-hash
  agreement, handoff kind, expiry, and optional server-offered file ID, and never accepts a magnet,
  hash, path, or TorServer target from a caller;
- TorServer add/metadata work is bounded by total/concurrent-start limits and high-entropy session
  IDs. Identical info hashes share preparation and use reference counting; the final stop, expiry,
  cancellation, or application shutdown performs one best-effort `drop`;
- sanitized video files are selected automatically only for an unambiguous movie or requested
  episode. Ambiguous metadata produces `file_selection_required` with a bounded safe list;
- states are `starting`, `file_selection_required`, `ready`, `conversion_required`, `failed`, and
  `stopped`. File classification is deliberately limited to `direct`, `remux_required`,
  `transcode_required`, or `unknown`; it describes reference-path preparation and is not a promise
  that a particular browser supports the codecs.
- every session snapshot contains an expiring high-entropy `streamUrl`, usable only while a file is
  selected and the session is ready or conversion-required. The API
  resolves its TorServer `/play/{hash}/{fileId}` target exclusively from server-owned session
  state and streams the response with backpressure instead of buffering media in memory;
- the stream gateway accepts `GET` and `HEAD`, normalizes exactly one satisfiable byte range,
  forwards only `Range` and bounded cache validators, rejects redirects and inconsistent upstream
  status/length/range headers, and returns only a small safe set of media/cache headers;
- browser and session cancellation abort upstream work. Eight simultaneous response bodies and a
  30-second body-idle timeout are the defaults; excess streams fail immediately rather than queue.

The default private limits are a 500-entry/five-minute candidate catalog, eight total sessions,
two concurrent starts, a 45-second start budget, a 30-minute session TTL, at most 100 offered
files, eight active streams, and a 30-second stream-idle timeout. Their strict
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
```

Then start the explicit profile:

```bash
docker compose --profile torrent-playback up
```

The TorServer container has no `ports` mapping. Only the API joins its dedicated Compose network;
the example remains on the default network. The container uses a read-only root filesystem,
drops Linux capabilities, prevents privilege escalation, rotates bounded logs, and defaults to one
GiB RAM, two CPUs, and 256 PIDs. Its writable config, torrent-autoload, and `/tmp` paths are bounded
ephemeral tmpfs mounts. TorServer itself runs in read-only-settings mode, which keeps its upstream
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

The API now provides bounded Range delivery, but no player UI, remuxer, or transcoder yet.
`conversion_required` therefore remains an honest state rather than a claim that the browser can
play the selected file. `GET /media/torrents` itself remains discovery-only.

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
проверяются magnet/info hash, identity, handoff и expiry; одинаковые hash используют общую
подготовку и refcount до финального cleanup.

Неоднозначный набор файлов возвращает `file_selection_required`; состояния conversion и
совместимость direct/remux/transcode/unknown не обещают поддержку конкретным браузером.

App-specific routes create/status/stop теперь доступны только при совместной настройке точного
`MEDIA_ENGINE_TORRSERVER_URL` и отдельного `MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN` длиной 32-512
символов. Токен передаётся как Bearer, сравнивается через fixed-size digest, не возвращается API и
не входит в SDK/frontend. Отдельный строгий rate limit по умолчанию разрешает 10 playback-запросов
в минуту; глобального списка сессий нет. Публичный playback health сообщает только
disabled/ok/unavailable и не влияет на основную `/health/ready`.

Сессия с выбранным файлом возвращает короткоживущий `streamUrl` для `GET`/`HEAD`. Его случайный
256-битный ID служит capability, потому что нативный browser media element не умеет добавлять
операторский Bearer token. URL нужно считать секретом: не сохранять, не отправлять в аналитику и не
передавать между origin. После expiry или stop он перестаёт работать. Gateway разрешает только один
валидный byte range, безопасные cache validators и ограниченный набор response headers; redirect и
несогласованные 200/206/304/416 отклоняются. Поток идёт с backpressure без полной буферизации,
disconnect отменяет upstream. По умолчанию разрешено восемь активных потоков с idle timeout 30 с.

Обычный `docker compose up` TorServer не запускает. После настройки
`MEDIA_ENGINE_TORRSERVER_URL=http://torrserver:8090` и отдельного playback token официальный image
можно явно включить командой `docker compose --profile torrent-playback up`. Релиз
`MatriX.141.1` закреплён одновременно tag и immutable digest; host port отсутствует, а отдельную
Compose-сеть с сервисом разделяет только API. Read-only rootfs/settings, bounded ephemeral tmpfs,
ротация логов и лимиты RAM/CPU/PID удерживают deployment в заданных границах; upstream memory
cache остаётся на проверенном default 64 MiB.

Во встроенном профиле Basic Auth TorServer не включён: сервис изолирован сетью, а внешние
create/status/stop уже требуют независимый Bearer token. Для operator-managed внешнего TorServer
можно явно передать URL и парные Basic credentials; host-local экземпляр доступен из Compose как
`http://host.docker.internal:8090`. Внешний экземпляр должен оставаться за firewall в приватной
сети: у проверенного релиза Basic Auth защищает management endpoints, но `/play` зарегистрирован
вне authenticated route group. Range gateway уже доступен, но UI, remux и transcode остаются
следующими независимыми этапами; magnet, target URL и file path от браузера не принимаются. Переход
на другую версию TorServer требует повторной проверки контракта и нового immutable digest.
