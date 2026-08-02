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
3. Repository torrent-playback hardening and final browser acceptance are complete.
   The opt-in discovery bridge, minimal internal TorrServer adapter, authenticated server-owned
   session/file selection lifecycle, protected original HTTP/Range gateway, and example's native
   browser player are complete. Bounded creation/stream concurrency and a create-only per-client
   budget, deterministic ownership, startup recovery, runtime-restart detection, redacted
   observability, phase-by-phase outage coverage, cleanup soak validation, deterministic real-runtime
   Range coverage, automated native Firefox acceptance, and real Firefox video/audio/seek acceptance
   are complete. Additional browsers remain supplementary compatibility observations because the
   original-file route does not promise universal decoding. Do not reintroduce media probing, remux,
   transcode, HLS, FFmpeg, worker processes, external-player fallback, or broad runtime profiles.
4. The complete code and architecture audit is finished. It removed internal dependency cycles,
   centralized genuinely shared API query and validation contracts, and separated the original-file
   upstream response boundary from stream lifecycle orchestration. The scan found no dead production
   modules; large remaining coordinators stay intact where their state and sequencing are cohesive.
   Public package and REST contracts were preserved throughout the small reviewable changes.
5. The deterministic clean-install, package, runtime, Docker, Range, and browser checkpoints are
   complete. Preparation of `1.0.0` proceeds with an explicit live-upstream exception: the latest
   scheduled metadata matrix found every expected identity and no contract regression, but its 15
   upstream-degraded warnings exceeded the unchanged budget of four. Continue monitoring this gate
   without weakening or presenting it as healthy.
6. The bilingual beginner quick start is complete. Without requiring architecture knowledge, it
   builds a minimal NestJS backend with one long-lived Media Engine instance and calls its search
   route from a Vite frontend through the SDK. The copy-paste flow is verified against fresh NestJS
   11 and current Vite scaffolds using the published packages.
7. The three jointly versioned public packages, changelog, release notes, consistency gate, and dry
   package artifacts are prepared for `1.0.0`. The private application versions remain at `0.0.0`,
   the independently versioned REST/OpenAPI contract remains at `0.12.0`, and the complete
   deterministic release gate passes for the candidate.

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
