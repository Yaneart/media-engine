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
   smoke gate. Keep API defaults empty while their anonymous quotas and timeout tails require an
   application-owned request budget. Media Engine returns typed candidates and playback handoff
   data without bundling a frontend player, video proxy, BitTorrent client, storage, or transcoder.
3. Use the repository API and example applications as an opt-in reference playback stand:
   env-gated torrent discovery and source-preserving candidate selection are complete. A private
   bounded client now defines the reviewed contract with an external, separately licensed
   TorServer process. A fresh-only server-owned candidate catalog and bounded private session
   lifecycle now revalidate handoffs, coalesce identical hashes, select safe files, and clean up by
   reference count. App-specific protected create/status/stop routes, a separate optional health
   probe, Bearer authorization, and strict playback rate limits are complete without expanding the
   SDK. The official TorServer image is now pinned by release tag/digest behind an explicit Compose
   profile with no host port and bounded resources. Bounded GET/HEAD Range delivery is complete via
   an expiring capability URL, with strict upstream validation, backpressure, disconnect cleanup,
   independent concurrency, and idle limits. The opt-in example player flow now keeps lifecycle
   credentials behind a same-origin server boundary, uses the expiring capability in native media,
   exposes file selection and cleanup, and keeps conversion-required states honest without moving
   P2P runtime responsibilities into the public packages. Complete live reference-stand proof for
   progressive 2160p startup, seeking, buffering, and cleanup across representative files. A
   host-only opt-in bounded ffprobe adapter now replaces release-name heuristics with exact primary
   stream/container classification before readiness; next move that contract behind an isolated
   container-native worker before implementing remux or transcode jobs.
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
- Media Engine returns normalized discovery and playback handoff data; consuming applications
  own their UI, player, proxy, torrent runtime, storage, and transcoding decisions;
- repository applications may demonstrate and verify that handoff, but reference playback
  components must remain optional and outside public package runtime dependencies;
- live upstream data is described honestly as best-effort;
- one slow or broken provider must not hide useful results from healthy providers;
- shared code must represent genuinely shared semantics, not merely similar syntax;
- structural cleanup must preserve public contracts and proven behavior;
- measured reliability and performance matter more than a long feature checklist.
