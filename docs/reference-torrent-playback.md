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

The private client contract was reviewed against TorServer `MatriX.141.1`, source commit
`49cef22fc02c501d844cfebe7a7c00ad0c6758f2`. A later Docker block will pin a reviewed official image
by both release tag and immutable digest. Upgrading that pin requires reviewing the `/echo`,
`POST /torrents`, and `/play/{hash}/{fileId}` behavior again and rerunning the contract tests; the
deployment must never silently follow `latest`.

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

The default private limits are a 500-entry/five-minute candidate catalog, eight total sessions,
two concurrent starts, a 45-second start budget, a 30-minute session TTL, and at most 100 offered
files. Their strict `MEDIA_ENGINE_TORRENT_CANDIDATE_*` and
`MEDIA_ENGINE_TORRENT_PLAYBACK_*` settings are listed in `.env.example`; they do not enable a
playback route or TorServer process.

The catalog/session service is not wired to a public playback HTTP endpoint and starts no
TorServer process. Authorization, Docker opt-in, the Range gateway, and browser UI are later
independent stages. Until those stages are complete, `GET /media/torrents` remains discovery-only.

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

Неоднозначный набор файлов возвращает внутреннее состояние `file_selection_required`; состояния
conversion и совместимость direct/remux/transcode/unknown не обещают поддержку конкретным
браузером. Playback route всё ещё отсутствует, TorServer не запускается, а magnet, target URL и
file path от браузера не принимаются. Версия Docker позже будет закреплена одновременно release
tag и immutable digest; переход на другую версию потребует повторной проверки контракта.
