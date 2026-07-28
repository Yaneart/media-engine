# ADR 0001: Stream original torrent files through TorrServer

- Status: accepted
- Decision date: 2026-07-27
- Baseline captured: 2026-07-28

## Context

Media Engine already has torrent discovery contracts in `@media-engine/core`, concrete discovery
providers in `@media-engine/providers`, and a discovery method in `@media-engine/sdk`. An
experimental application layer later added torrent sessions, media inspection, remuxing,
transcoding, generated HLS, and several playback modes.

That experiment made the runtime and product contract much larger than the feature needs. It also
blurred two different guarantees: whether the application can stream a torrent file and whether a
particular browser can decode that file.

## Decision

The reference feature will have one playback route:

```text
server-resolved torrent source
  -> mandatory TorrServer
  -> protected original HTTP/Range stream
  -> one native browser <video> element
```

TorrServer is the only torrent transport. If it is disabled, unhealthy, incompatible, stopped, or
unreachable, playback fails as `torrserver_unavailable`; the application does not try another
engine or player.

The browser selects a server-known discovery observation and, when necessary, a server-offered file
index. It cannot submit a TorrServer address, upstream URL, filesystem path, torrent hash, magnet,
or stream target independently. The API resolves the selected observation, owns the TorrServer
entry and session lifecycle, and exposes only a high-entropy expiring stream capability.

Every non-padding regular file reported by TorrServer is selectable regardless of its name or
extension. `ready` means that the original byte stream is available; it is not a codec promise. A
healthy stream that the native player rejects is reported as `client_format_unsupported`.

The stream gateway supports `GET`, `HEAD`, cancellation, and browser Range requests. It preserves
validated `200`, `206`, and `416` behavior and required length/range headers, streams with
backpressure, uses separate control/header/inactivity deadlines, rejects redirects, and never
exposes TorrServer credentials or internal addresses.

The application owns bounded creation, metadata wait, file selection, reference counting, stop,
expiry, page-close cleanup, and shutdown cleanup. Browser `playing`, `waiting`, and media-error
events remain client diagnostics rather than server session states.

Public contracts in `@media-engine/core`, `@media-engine/providers`, and `@media-engine/sdk` remain
discovery-only. TorrServer, sessions, byte streaming, and browser playback stay app-specific.

## Session states

```text
adding -> waiting_metadata -> selection_required -> ready -> stopped
                         \-> ready
any active state -> failed | stopped | expired
```

## Stable errors

- `torrserver_unavailable`: the required service is disabled, unhealthy, incompatible, or
  unreachable.
- `torrent_source_invalid`: the resolved magnet or bounded torrent payload is invalid.
- `torrent_metadata_timeout`: metadata did not arrive before the bounded deadline.
- `torrent_pieces_unavailable`: peers did not provide the requested original pieces.
- `torrent_file_not_found`: the recorded file index no longer matches the torrent.
- `torrent_file_selection_required`: several files require an explicit bounded selection.
- `torrent_stream_failed`: TorrServer returned an invalid or non-transient stream response.
- `client_format_unsupported`: the native browser player rejected a healthy original stream.
- `session_stopped` / `session_expired`: the stream capability is no longer valid.

Network/piece failures must not be described as codec failures, and browser rejection must not be
described as a TorrServer outage.

## Non-goals

- FFmpeg, ffprobe, media-worker processes, or private conversion protocols.
- Remux, transcode, HLS/CMAF generation, prepared downloads, output storage, or conversion progress.
- Codec classification from filenames, browser capability negotiation, or universal decode claims.
- mpv, VLC, libmpv, M3U files, custom protocols, or fallback players.
- Archive extraction, disc menus, DRM/decryption, damaged-media repair, or non-media interpretation.

## Consequences

The runtime, security model, session state, UI, and operational surface become smaller. Original
files retain their source quality and support ordinary HTTP seeking without generated artifacts.

Some healthy files will not play in some browsers. This is an intentional, visible product
boundary. Better compatibility must come from choosing a browser-compatible release, not from a
hidden conversion or external-player route.

The existing application/runtime torrent integration will be deleted before the new route is built.
Discovery contracts and implementations under `packages/core`, `packages/providers`, and
`packages/sdk` are preserved.

## Transition inventory

At base commit `a35dff9c845c86e8e5e58bcf62cf3548e0c9ab7f`, the abandoned bounded-HLS
prototype occupies 40 uncommitted paths: 35 modified and 5 untracked. Earlier planning counted 39;
this audit corrects that count. All 40 paths are explicitly disposable and will be removed or
rewritten through reviewed patches in the next block. They are not archived, staged, committed, or
preserved on a checkpoint branch.

### API and worker: 30 paths

- `apps/api/Dockerfile.media-worker`
- `apps/api/src/reference-playback/controller.spec.ts`
- `apps/api/src/reference-playback/controller.ts`
- `apps/api/src/reference-playback/file-selection.spec.ts`
- `apps/api/src/reference-playback/file-selection.ts`
- `apps/api/src/reference-playback/index.spec.ts` (untracked)
- `apps/api/src/reference-playback/media-probe.spec.ts`
- `apps/api/src/reference-playback/media-probe.ts`
- `apps/api/src/reference-playback/media-transcode-config.spec.ts` (untracked)
- `apps/api/src/reference-playback/media-transcode-config.ts` (untracked)
- `apps/api/src/reference-playback/media-transcode.spec.ts` (untracked)
- `apps/api/src/reference-playback/media-transcode.ts` (untracked)
- `apps/api/src/reference-playback/media-worker-client.spec.ts`
- `apps/api/src/reference-playback/media-worker-client.ts`
- `apps/api/src/reference-playback/media-worker-config.spec.ts`
- `apps/api/src/reference-playback/media-worker-config.ts`
- `apps/api/src/reference-playback/media-worker-server.spec.ts`
- `apps/api/src/reference-playback/media-worker-server.ts`
- `apps/api/src/reference-playback/rate-limit.spec.ts`
- `apps/api/src/reference-playback/rate-limit.ts`
- `apps/api/src/reference-playback/reference-playback.module.spec.ts`
- `apps/api/src/reference-playback/reference-playback.module.ts`
- `apps/api/src/reference-playback/session-lifecycle.spec.ts`
- `apps/api/src/reference-playback/session-record.ts`
- `apps/api/src/reference-playback/session-service.ts`
- `apps/api/src/reference-playback/stream-gateway.ts`
- `apps/api/src/reference-playback/types.ts`
- `apps/api/src/torrent-media-worker.ts`
- `apps/api/README.md`
- `apps/api/README.ru.md`

### Example application: 5 paths

- `apps/example/src/App.css`
- `apps/example/src/api/reference-player.ts`
- `apps/example/src/components/ReferenceTorrentPlayer.tsx`
- `apps/example/README.md`
- `apps/example/README.ru.md`

### Runtime configuration: 2 paths

- `.env.example`
- `compose.yaml`

### Repository documentation: 3 paths

- `CHANGELOG.md`
- `docs/reference-torrent-playback.md`
- `docs/roadmap.md`

The deletion block is broader than this dirty-file inventory: it will remove all existing
torrent-specific code and tests from `apps/api` and `apps/example`, plus torrent-only Compose and
environment configuration, even where a tracked file is currently unchanged.

## Transition baseline

The baseline was measured before this ADR changed repository files.

- Git: branch `main`, commit `a35dff9c845c86e8e5e58bcf62cf3548e0c9ab7f`.
- Toolchain: Node.js `v26.5.0`, pnpm `11.9.0`, Docker Compose `5.3.1`.
- TorrServer: `MatriX.141.1`, source revision
  `49cef22fc02c501d844cfebe7a7c00ad0c6758f2`, pinned image digest
  `sha256:e44f08ec579615a783c3ab45e00595f50e9e5f94810dc06910c201edecd6205b`.
- Disposable media worker image:
  `sha256:511d862a070fe130ae6cb92a247c3250603bd05312095536cae67ad60579b527`.
- Runtime audit: TorrServer and the media worker were healthy; TorrServer returned an empty list;
  no FFmpeg/ffprobe process was running; the worker volume contained only empty `remux` and
  `remux/transcode` directories and no output files.
- Default and `torrent-playback` profile Compose configuration both validated.
- `pnpm build:check`, `pnpm lint`, and `pnpm typecheck` passed. The example production build passed
  with the existing generated `hls.js` chunk-size warning.
- Package coverage passed: core 234/234 tests (96.87% lines, 93.09% branches, 96.35% functions),
  providers 277/277 (94.56%, 82.28%, 96.91%), and SDK 11/11 (96.00%, 92.42%, 96.00%).
- Example tests passed 8/8, smoke-policy tests passed 8/8, API e2e passed 11/11, and package dry-pack
  verification passed with 181 core, 220 provider, and 10 SDK files.
- API unit tests passed 374/374, but `coverage:unit` failed because function coverage was 87.95%
  against the 88% threshold.
- The aggregate `pnpm release:check` stopped at `format:check` because the disposable
  `apps/example/src/components/ReferenceTorrentPlayer.tsx` is not Prettier-clean.

The two failing gates belong to the already abandoned prototype. This decision does not polish or
raise coverage for code that the next block deletes; it records the failures so the clean-slate
checkpoint can be compared honestly.

## Русский

Для torrent playback принят один путь: сервер выбирает известный torrent-кандидат, обязательный
TorrServer отдаёт оригинальные байты через защищённый HTTP/Range gateway, а example-приложение
использует один нативный `<video>`. FFmpeg, ffprobe, remux, transcode, HLS, внешний плеер и fallback
не входят в продукт.

Любой обычный non-padding файл можно выбрать независимо от расширения. Возможность передать байты
не означает, что конкретный браузер умеет их декодировать. Поэтому доступный torrent может честно
завершиться `client_format_unsupported`; отсутствие peers или pieces остаётся сетевой ошибкой и не
маскируется под несовместимый формат.

Браузер не управляет magnet, hash, внутренним URL TorrServer, путём или play target. API владеет
разрешением кандидата, session lifecycle, file index и короткоживущим capability URL. Публичные
пакеты core/providers/SDK по-прежнему отвечают только за discovery.

Текущий 40-файловый HLS-прототип признан одноразовым. Следующий отдельный блок удалит весь
torrent-код из API, example и Compose, сохранив torrent-discovery контракты и реализации в
`packages/core`, `packages/providers` и `packages/sdk`.
