# Media Engine

**English** | [Русский](README.ru.md)

Movie data is easy to find. The hard part is that every source names things differently, uses different IDs, and sometimes simply stops responding.

Media Engine puts those sources behind one TypeScript API. You ask for a movie, series, or anime; the engine calls suitable providers, joins matching results, and tells you honestly when part of the data could not be loaded.

Version `0.1.1` is available on npm.

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

## A small but important warning

Media Engine works with public third-party sources. They can be slow, unavailable, or change without warning. The engine limits failures and returns partial results when it can, but it cannot promise that every source or player will always work.

Media Engine does not host video. It only normalizes information and third-party player options for your application.

## Learn more

The [documentation index](docs/README.md) links to the architecture, API, data model, providers, and roadmap. Package-specific setup stays in each package README so this page does not repeat it.

For local checks:

```bash
pnpm release:check
pnpm pack:check
```

## License

MIT
