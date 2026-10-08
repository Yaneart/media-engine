# Documentation / Документация

This folder contains the details that would only make the main README harder to read.

Здесь лежат подробности, которыми не хочется перегружать главный README.

## Start here / С чего начать

- [Quick start](quick-start.md) — build a small backend and call it from a frontend;
- [Быстрый старт](quick-start.ru.md) — тот же пример на русском;
- [Public API](public-api.md) — the four main engine and HTTP operations;
- [Providers](providers.md) — built-in data sources and their settings.

## More details / Остальные материалы

- [Architecture](architecture.md) — packages and request flow;
- [Data model](data-model.md) — normalized media, player, and torrent types;
- [Quality gates](quality-gates.md) — tests, checks, and live smoke policy;
- [Original torrent streaming decision](decisions/0001-original-torrent-streaming.md) — security and
  lifecycle boundaries;
- [Roadmap](roadmap.md) — completed work and future plans;
- [Resilient sources plan](resilient-sources-plan.md) — active cross-repository metadata and
  streaming resilience program;
- [RP-001 baseline audit](rp-001-baseline-audit.md) — current provider graph, latency, cache, and
  KinoBD-down evidence;
- [RP-002 metadata evaluation](rp-002-russian-metadata-evaluation.md) — official TMDB and direct
  anime-source localization, identity, artwork, latency, and usage evidence;
- [RP-003 metadata contract](rp-003-primary-metadata-contract.md) — primary routing, coherent
  snapshots, cache/stale behavior, bounded fallback, budgets, provenance, and ownership;
- [RP-005 metadata gate](rp-005-metadata-performance-resilience.md) — repeated cold, warm, stale,
  degraded, localization, identity, and critical-path evidence;
- [Versioning](versioning.md) — release and compatibility rules.

The exported TypeScript types are the source of truth for exact fields. The documents here explain
how the pieces fit together and why the project behaves the way it does.

Точные поля всегда лучше смотреть в экспортируемых TypeScript-типах. Эти документы объясняют общую
логику проекта и причины принятых решений.
