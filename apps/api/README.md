# @media-engine/api

NestJS REST API for Media Engine.

The API owns HTTP routing, DTO/query parsing, provider configuration, health checks, and Swagger/OpenAPI exposure. It must not own provider HTTP clients, merge logic, or core media models.

## Endpoints

```txt
GET /
GET /health
GET /providers
GET /media/search
GET /media/details
GET /docs
GET /docs-json
```

`/media/search` and `/media/details` map query parameters to `SearchQuery` and `DetailsQuery` from `@media-engine/core`.

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
