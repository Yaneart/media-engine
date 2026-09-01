# Media Engine

**English** | [Русский](README.ru.md)

Media Engine is a TypeScript library that gives you one clean API for movies, series, and anime.
It searches several public sources, recognizes when they describe the same title, merges their
answers, and keeps useful results even when one of the sources is down.

Version `1.4.0` is the current release.

## Quick start

You need Node.js 20 or newer.

```bash
npm install @media-engine/core @media-engine/providers
```

Create one `MediaEngine` instance and keep it for the lifetime of your application:

```ts
import { MediaEngine } from "@media-engine/core";
import { cinemetaProvider, kinobdProvider } from "@media-engine/providers";

const media = new MediaEngine({
  providers: [kinobdProvider(), cinemetaProvider()],
});

const result = await media.search({
  title: "Interstellar",
  language: "en",
});

console.log(result.results[0]?.item);
console.log(result.meta.providers.failed);
```

You can also search and load details by a known external ID:

```ts
const search = await media.search({ imdb: "tt0816692" });
const details = await media.getDetails({ imdb: "tt0816692" });
```

The built-in providers do not require API keys, account cookies, or private tokens.

If you are building a browser application, do not create the engine in the browser. Put it in your
backend and call that backend through `@media-engine/sdk`. The
[beginner quick start](docs/quick-start.md) walks through a complete NestJS and Vite example.

## What you get

- [`@media-engine/core`](https://www.npmjs.com/package/@media-engine/core) — the engine, public
  types, caching, merging, timeouts, and error handling;
- [`@media-engine/providers`](https://www.npmjs.com/package/@media-engine/providers) — ready-to-use
  metadata, player, and optional torrent-discovery providers;
- [`@media-engine/sdk`](https://www.npmjs.com/package/@media-engine/sdk) — a typed client for the
  included REST API;
- `apps/api` — a NestJS API that shows how to run one shared engine on a server;
- `apps/example` — a small React application that uses the API.

Search, player lookup, and torrent discovery are separate. Use only the parts your application
actually needs.

## Run the example

For the complete local stack you only need Docker. Compose keeps pnpm dependencies in a persistent
Linux volume and installs them automatically when the lockfile changes.

```bash
cp .env.example .env
```

Generate a secret:

```bash
openssl rand -hex 32
```

Paste it into `.env` as `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN`, then start the stack:

```bash
docker compose up -d
```

Open:

- example application: <http://127.0.0.1:5173>;
- API: <http://127.0.0.1:3000>;
- Swagger: <http://127.0.0.1:3000/docs>.

Stop everything with:

```bash
docker compose down
```

Ordinary `docker compose down` keeps the dependency volume, so later starts are fast. The first
start, or a start after `docker compose down -v`, must install dependencies and will take longer.

Torrent providers are disabled until you explicitly enable them in `.env`. The example can stream
the exact selected original file through its private TorrServer-backed route, but it does not probe,
convert, remux, or transcode media. Whether a file plays depends on the browser's support for its
container and codecs. See the
[original-torrent architecture decision](docs/decisions/0001-original-torrent-streaming.md) for the
security and lifecycle details.

## A note about public sources

Public providers can be slow, unavailable, rate-limited, or changed by their owners. Media Engine
bounds their work and reports partial failures instead of hiding successful data from other sources,
but it cannot guarantee that every third-party source or player will always work.

Media Engine does not host video. It normalizes metadata and third-party handoff options for your
application.

Optional streaming sources include direct Filmix, VeoVeo, and VideoHUB adapters plus an official
Rutube movie embed adapter. Each stays disabled until its corresponding `.env` flag is enabled.

## Documentation and development

Start with the [documentation index](docs/README.md). It links to the public API, provider list,
architecture, data model, quality gates, and roadmap. Exact fields are documented by the exported
TypeScript types.

Useful repository checks:

```bash
pnpm release:check
pnpm smoke:search-quality:scheduled
# Requires the running Compose stack and Firefox:
pnpm smoke:torrent-browser
```

`release:check` covers formatting, builds, lint, type checks, unit coverage, API end-to-end tests,
version consistency, and dry package contents. The published packages support Node.js 20 and newer;
the full repository coverage gate requires Node.js 22.8 or newer.

## License

MIT
