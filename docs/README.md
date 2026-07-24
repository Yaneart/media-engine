# Media Engine documentation

This directory contains current technical documentation for Media Engine.

- [Architecture](architecture.md) explains the packages, dependency boundaries, and request flow.
- [Public API](public-api.md) shows the main library and HTTP operations without duplicating every TypeScript type.
- [Data model](data-model.md) describes the normalized media and streaming shapes.
- [Providers](providers.md) lists the built-in providers and their safety boundaries.
- [Quality gates](quality-gates.md) documents deterministic CI and classified live smoke policy.
- [Roadmap](roadmap.md) contains a short public view of completed and planned work.
- [Reference torrent playback](reference-torrent-playback.md) defines the optional external TorServer boundary and its pinned-contract policy.

The TypeScript declarations exported by the packages are the source of truth for exact fields. Package READMEs contain installation and quick-start examples.

Internal task lists, session notes, audit logs, and completed release plans are intentionally not stored here. They become stale quickly and are not useful product documentation.
