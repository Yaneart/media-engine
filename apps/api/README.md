# @media-engine/api

NestJS REST API for Media Engine.

The API owns HTTP routing, DTO/query parsing, provider configuration, health checks, and Swagger/OpenAPI exposure. It must not own provider HTTP clients, merge logic, or core media models.

## Endpoints

```txt
GET /
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

Movie and series search works without secrets through KinoBD, Cinemeta, Shikimori, and Wikidata. For richer movie and series metadata, set a TMDB token in the repository root `.env` file:

```txt
TMDB_API_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

Streaming availability works without secrets through the default KinoBD/ReYohoho-style streaming provider. It returns normalized embed player options from KinoBD-style `/api/player/search` and `/playerdata` endpoints when a source is available. Anime availability can fall back from a Shikimori ID to Shikimori title lookup and KinoBD player search.

To add the direct Kodik API provider as an extra source, set a Kodik API token:

```txt
KODIK_TOKEN=your_kodik_token
```

The API loads the nearest `.env` file on local startup without overriding already exported environment variables.

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
