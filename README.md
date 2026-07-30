# Media Engine

**English** | [Русский](README.ru.md)

Movie data is easy to find. The hard part is that every source names things differently, uses different IDs, and sometimes simply stops responding.

Media Engine puts those sources behind one TypeScript API. You ask for a movie, series, or anime; the engine calls suitable providers, joins matching results, and tells you honestly when part of the data could not be loaded.

Version `0.1.1` is available on npm.

Package, API contract, and User-Agent versions have distinct meanings; see the
[versioning and package build contract](./docs/versioning.md).

## Try it

You need Node.js 20 or newer.

```bash
npm install @media-engine/core @media-engine/providers
```

```ts
import { MediaEngine } from "@media-engine/core";
import {
  aniListProvider,
  cinemetaProvider,
  kinobdProvider,
  shikimoriProvider,
  tvMazeProvider,
  wikidataProvider,
} from "@media-engine/providers";

const media = new MediaEngine({
  providers: [
    kinobdProvider(),
    cinemetaProvider(),
    shikimoriProvider(),
    aniListProvider(),
    tvMazeProvider(),
    wikidataProvider(),
  ],
});

const result = await media.search({
  title: "Interstellar",
  language: "en",
});

console.log(result.results[0]?.item);
```

You can search by external ID too:

```ts
const result = await media.search({ imdb: "tt0816692" });
```

No API keys, private tokens, or account cookies are needed for the built-in providers.

## What is included

- [`@media-engine/core`](https://www.npmjs.com/package/@media-engine/core) — the engine and public types;
- [`@media-engine/providers`](https://www.npmjs.com/package/@media-engine/providers) — ready-to-use metadata and player sources;
- [`@media-engine/sdk`](https://www.npmjs.com/package/@media-engine/sdk) — a typed client for the included REST API;
- `apps/api` — a runnable NestJS API;
- `apps/example` — a small React example.

Metadata and player lookup are separate. You can use Media Engine only for search and details, or add streaming providers when your application needs player choices.

## See it in a browser

```bash
pnpm install
pnpm dev:compose
```

Then open <http://127.0.0.1:5173>. The API runs on <http://127.0.0.1:3000>, and its Swagger page is at <http://127.0.0.1:3000/docs>.

The default Compose stack includes a separately licensed, pinned, non-published TorrServer runtime.
Set one random 32+ character `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN` in `.env`, then start the complete
stack:

```bash
docker compose up -d
```

TorrServer has no host port. It uses a private API network plus a dedicated outbound network for
trackers, DHT, and peers. The application can create expiring server-owned sessions from an
exact discovery observation, coalesce sessions that share an info hash, list every non-padding file
without extension filtering, validate a selected numeric file ID, and clean up on stop, expiry, or
API shutdown. The API never accepts a raw magnet, hash, upstream URL, path, or TorrServer target.
A stable, deployment-unique `MEDIA_ENGINE_TORRSERVER_OWNER_ID` marks only entries created by that
API deployment. Startup removes its stale marked entries, while pre-existing unmarked entries are
borrowed and never deleted. Timestamped ownership leases invalidate stale stream capabilities if
TorrServer restarts or replaces an entry, and an incompatible pinned runtime version stops startup.
A ready session exposes only a high-entropy application capability. Its protected `GET`/`HEAD`
route streams the exact selected original file with strict single-range handling, backpressure,
cancellation, bounded cold-start timeouts, bounded active-stream concurrency, and bounded session
creation while keeping TorrServer private. A separate per-client budget covers only session create
requests, leaving status, selection, and Stop available. The example uses a
server-authenticated same-origin BFF for lifecycle calls and one native `<video>` for that original
capability. It distinguishes metadata wait from first-piece buffering and reports browser rejection
as `client_format_unsupported`. No media worker, probe, remuxer, transcoder, or HLS pipeline exists.
Structured server logs expose only bounded operational fields: metadata and upstream wait latency,
first-byte timing, Range offsets, cancellation/outcome, active counts, shared references, and
cleanup. They never include capabilities, hashes, magnets, torrent bytes, file names, internal URLs,
credentials, or raw error messages.

## A small but important warning

Media Engine works with public third-party sources. They can be slow, unavailable, or change without warning. The engine limits failures and returns partial results when it can, but it cannot promise that every source or player will always work.

Media Engine does not host video. It only normalizes information and third-party player options for your application.

## Learn more

The [documentation index](docs/README.md) links to the architecture, API, data model, providers, and roadmap. Package-specific setup stays in each package README so this page does not repeat it.

For local checks:

```bash
pnpm release:check
pnpm coverage
pnpm pack:check
pnpm smoke:search-quality:scheduled
# Requires the running Compose stack and host Firefox:
pnpm smoke:torrent-browser
```

`release:check` is the complete local release-candidate gate: formatting, check-only lint,
clean builds, type checks, thresholded unit coverage, API e2e tests, version consistency, and
dry-pack verification. Built-in coverage filtering and thresholds require Node.js 22.8 or newer;
the published packages retain their documented Node.js 20 runtime support.

Pushes and pull requests run the deterministic gate on Node.js 24 and 26, while the public
packages are tested separately on their minimum Node.js 20 line. Live provider checks are kept out
of the pull-request gate and run through the scheduled/manual network workflow with classified
results and an explicit warning budget. See [quality gates and live smoke policy](docs/quality-gates.md).

## License

MIT
