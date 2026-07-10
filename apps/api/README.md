# @media-engine/api

NestJS REST API for Media Engine.

The API owns HTTP routing, DTO/query parsing, provider configuration, health checks, and Swagger/OpenAPI exposure. It must not own provider HTTP clients, merge logic, or core media models.

## Endpoints

```txt
GET /health
GET /providers
GET /providers/streaming
GET /media/search
GET /media/details
GET /media/availability
GET /docs
GET /docs-json
```

`/media/search`, `/media/details`, and `/media/availability` map query parameters to `SearchQuery`, `DetailsQuery`, and `StreamQuery` from `@media-engine/core`.

## Local Development

From the repository root:

```bash
pnpm dev:api
```

From this package:

```bash
pnpm --filter @media-engine/api start:dev
```

The default local API URL is:

```txt
http://127.0.0.1:3000
```

Movie and series search works without secrets through KinoBD, Cinemeta, Shikimori, and Wikidata. The engine merges their results to improve metadata completeness.

Streaming availability works without secrets through the default KinoBD/ReYohoho-style streaming provider. It returns normalized embed player options from KinoBD-style `/api/player/search` and `/playerdata` endpoints when a source is available. Anime availability can fall back from a Shikimori ID to Shikimori title lookup and KinoBD player search.

The API loads the nearest `.env` file on local startup without overriding already exported environment variables.

Provider call budgets can be adjusted when an upstream is unusually slow:

```txt
MEDIA_ENGINE_PROVIDER_TIMEOUT_MS=5000
MEDIA_ENGINE_ENRICHMENT_PROVIDER_TIMEOUT_MS=2500
MEDIA_ENGINE_STREAMING_PROVIDER_TIMEOUT_MS=10000
```

Streaming uses a larger default budget because one cold availability lookup may include candidate search, player data loading, and bounded iframe validation.

The streaming value is the engine-wide upper boundary. Regular KinoBD and Shikimori metadata calls use the first value, while optional Cinemeta and Wikidata enrichment uses the shorter second value.

Successful search, details, and availability responses are cached in memory for five minutes. The cache is bounded to 500 least-recently-used entries so repeated requests are fast without unbounded process memory growth.

Swagger UI is available at:

```txt
http://127.0.0.1:3000/docs
```

## Checks

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

## Boundaries

- Configure providers through application configuration.
- Do not expose provider secrets in responses.
- Do not import React or the SDK.
- Keep provider-specific HTTP logic inside `@media-engine/providers`.
- Keep normalization and merge behavior inside `@media-engine/core`.
