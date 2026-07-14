# Providers

Providers are adapters between an external data source and the normalized core contracts. Core selects them by declared capabilities and does not know their HTTP implementation.

## Metadata providers

| Provider     | Main role                                                 | Credentials         |
| ------------ | --------------------------------------------------------- | ------------------- |
| KinoBD       | Russian/localized movie and series metadata               | None                |
| Cinemeta     | IMDb-linked movie and series metadata                     | None                |
| Shikimori    | Anime search and details                                  | None                |
| AniList      | International anime aliases, IDs, popularity, and artwork | None                |
| Wikidata     | Public structured identity and metadata enrichment        | None                |
| IMDb dataset | Optional local TSV-backed search and details              | Local dataset files |

Default applications can combine several providers. The merge strategy uses strong IDs and compatible titles to avoid treating unrelated results as the same item.

TMDB IDs remain supported in the normalized model because upstream providers may return them. There is no built-in TMDB API provider and users do not need a TMDB token.

## Streaming providers

| Provider               | Main role                                                                          | Credentials               |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| KinoBD streaming       | Discovers normalized player options for movies, series, and anime                  | None                      |
| FlixHQ streaming       | International embed options, subtitles, and explicit direct streams when available | None                      |
| Experimental streaming | Deterministic configured options for development and tests                         | Application configuration |

Streaming providers return targets and metadata; the consuming UI decides how to render an iframe or media element. A returned third-party option may still fail because of geography, browser policy, upstream changes, or temporary availability.

## Provider contract

A metadata provider declares:

- stable name and optional version;
- supported media types;
- title and external-ID search capabilities;
- detail lookup capabilities;
- optional features such as posters, ratings, people, seasons, or episodes;
- `search` and optional `getDetails` methods.

A streaming provider declares supported media types, external IDs, player kinds, and whether it supports movies, series, episodes, subtitles, translations, and direct streams. It implements `getAvailability`.

Provider methods receive request context with an abort signal, timeout, language, and debug flag. They should return normalized data and throw `ProviderError` for expected upstream failures.

## Reliability and safety

- Independent providers run concurrently behind engine timeouts.
- Retryable failures use bounded retry/backoff budgets.
- Optional provider failures do not erase successful results from other providers.
- HTTP response sizes and player validation concurrency are bounded where needed.
- Upstream-discovered URLs reject credentials and local/private/reserved network targets before server-side use or public exposure.
- Secrets, cookies, and private account tokens are not exposed through provider metadata.

Live integrations are best-effort. Their parsers and mappings are covered by fixtures and live smoke checks, but upstream HTML and APIs can change without notice.

## Adding a provider

1. Implement the core provider contract in `packages/providers/src/<name>`.
2. Keep configuration in the provider factory, not global state.
3. Normalize all output before returning it.
4. Add fixture-based tests for success, malformed responses, failures, timeout, and cancellation.
5. Export the factory from `packages/providers/src/index.ts`.
6. Document credentials, source limitations, and default application wiring honestly.
