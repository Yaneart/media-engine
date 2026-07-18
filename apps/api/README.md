# Media Engine API

**English** | [Русский](https://github.com/Yaneart/media-engine/blob/main/apps/api/README.ru.md)

A ready-to-run NestJS wrapper around Media Engine. It is useful when a browser or another service needs the engine over HTTP.

This app belongs to the GitHub repository and is not an npm package.

## Run it

From the repository root:

```bash
pnpm install
pnpm dev:api
```

The API starts at <http://127.0.0.1:3000>. Swagger is at <http://127.0.0.1:3000/docs>.

Try a request:

```bash
curl 'http://127.0.0.1:3000/media/search?title=Interstellar&language=en'
```

## Routes

```text
GET /health
GET /providers
GET /providers/streaming
GET /media/search
GET /media/details
GET /media/availability
GET /docs
GET /docs-json
```

`GET /media/details` requires a namespaced external ID such as `imdb`, `kinopoisk`, or `ids.shikimori`. A plain `id` is ambiguous across providers and returns HTTP 400.

Local settings come from `.env`. The useful defaults are documented in the root `.env.example`, including the port and provider timeouts. Metadata, KinoBD streaming, and FlixHQ keep independent timeout budgets; the larger FlixHQ value is not capped by the shorter generic streaming timeout.

## Check it

```bash
pnpm --filter @media-engine/api typecheck
pnpm --filter @media-engine/api test
pnpm --filter @media-engine/api test:e2e
```

Provider code lives in `@media-engine/providers`; merging lives in `@media-engine/core`. This app only connects them to HTTP and keeps secrets out of responses.

## License

MIT
