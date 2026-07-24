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

The first private slice lives under `apps/api/src/reference-playback/torrserver`. It provides:

- an exact operator-owned HTTP(S) base URL with optional paired Basic credentials;
- separate response-start, complete-request, and metadata-poll timeout budgets;
- bounded request concurrency, response bytes, file count, path length, and file size;
- health, add, get, bounded metadata polling, drop, and controlled play-target construction;
- strict status/file parsing, cancellation, redirect rejection, and redacted typed errors.

The response-start budget covers DNS, connection establishment, and receipt of response headers;
the complete-request budget remains active while the bounded body is read. Credentials, magnets,
upstream response bodies, and configured targets are not copied into client errors.

This slice is not wired to a public HTTP endpoint and starts no TorServer process. Session/catalog
ownership, authorization, Docker opt-in, the Range gateway, and browser UI are later independent
stages. Until those stages are complete, `GET /media/torrents` remains discovery-only.

## Русский

Публичные пакеты Media Engine заканчиваются на нормализованном поиске torrent-кандидатов и opaque
handoff. Опциональный reference playback будет использовать отдельно запущенный TorServer как
внешний GPL-3.0 компонент; его исходный код, бинарник и container layers не входят в этот MIT
репозиторий и публичные npm-пакеты.

Текущий приватный client slice только фиксирует и тестирует ограниченный контракт TorServer
`MatriX.141.1`: operator-owned URL, парные Basic credentials, timeout/concurrency/resource limits,
health/add/get/poll/drop и server-controlled play target. Он ещё не подключён к HTTP API, не
запускает TorServer и не принимает magnet, target URL или file path от браузера. Версия Docker
позже будет закреплена одновременно release tag и immutable digest; переход на другую версию
потребует повторной проверки контракта.
