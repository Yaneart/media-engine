# Roadmap

This roadmap is intentionally short. Detailed task lists and session plans are kept outside the public repository because they become stale quickly.

## Released

The `0.1.x` releases established and hardened the first public baseline:

- framework-independent core engine;
- normalized movie, series, anime, and streaming models;
- concurrent metadata and streaming provider orchestration;
- no-token built-in providers plus optional local IMDb datasets;
- deterministic merging, caching, timeouts, retries, and partial failures;
- NestJS API, typed SDK, and React example;
- public npm packages for core, providers, and SDK;
- repeatable coverage, package, runtime, Docker, and live-upstream quality gates.

## Current focus

1. Monitor the accepted default DDBB and AniLiberty providers while keeping their requests bounded,
   failures isolated, attribution explicit, and `embed` versus direct-HLS classification accurate.
2. Monitor the accepted opt-in YTS, JacRed, Bitsearch, and Magnetz torrent sources with the combined
   source checkpoint. Keep repository API defaults empty while their anonymous quotas and timeout
   tails require an application-owned request budget. Media Engine returns typed candidates and
   handoff data without bundling a frontend player, video proxy, BitTorrent client, storage, or
   transcoder.
3. Rebuild repository torrent playback from the accepted ADR in small verified blocks: server-owned
   torrent selection, mandatory TorrServer transport, protected original HTTP/Range streaming, and
   the example's native browser video element. Do not reintroduce media probing, remux, transcode,
   HLS, FFmpeg, worker processes, external-player fallback, or broad runtime profiles.
4. Run a complete code and architecture audit, then remove proven dead code and accidental
   duplication and reorganize misplaced modules in small behavior-preserving changes.
5. Complete a clean-install, package, runtime, Docker, and live regression checkpoint before
   preparing `1.0.0`.
6. Finish with a minimal beginner quick start that shows, without requiring architecture
   knowledge, how to connect Media Engine to a NestJS backend and how a frontend should call that
   backend through the SDK.

## Later

- improve resilience when public upstream providers change;
- add providers only when their access model and usage boundaries are clear;
- expand localization and normalized subtitle/audio metadata;
- improve contributor documentation and release automation;
- evaluate additional metadata sources independently from streaming providers.

## Principles

- built-in providers must not require API keys, access tokens, private credentials, account
  cookies, or caller-domain binding;
- Kinobox, DDBB Live, RHServ, and token/account-bound downstream balancers are excluded from the
  current integration path;
- metadata and streaming remain separate layers;
- torrent discovery remains separate from immediate stream availability and playback;
- external IDs and provider attribution stay visible;
- Media Engine returns normalized discovery handoff data; consuming applications
  own their UI, player, proxy, torrent runtime, storage, and transcoding decisions;
- repository applications may demonstrate and verify that handoff, but torrent playback
  components must remain app-specific and outside public package runtime dependencies;
- live upstream data is described honestly as best-effort;
- one slow or broken provider must not hide useful results from healthy providers;
- shared code must represent genuinely shared semantics, not merely similar syntax;
- structural cleanup must preserve public contracts and proven behavior;
- measured reliability and performance matter more than a long feature checklist.
