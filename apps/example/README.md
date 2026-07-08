# @media-engine/example

React example app for Media Engine.

The app demonstrates browser usage through `@media-engine/sdk`. It calls the NestJS API and does not import provider packages or store provider API keys in the browser.

## What It Shows

- metadata search across configured API providers;
- details loading for a selected result;
- streaming availability loading through the SDK;
- player option grouping by normalized translation metadata;
- embed player preview/open flow for returned player URLs;
- provider failure and empty-state handling.

The example app is intentionally API-facing. Provider credentials and provider implementation details stay in `apps/api` and `@media-engine/providers`.

## Scripts

```bash
pnpm --filter @media-engine/example dev
pnpm --filter @media-engine/example build
pnpm --filter @media-engine/example typecheck
```

By default, the development server runs at:

```txt
http://127.0.0.1:5173
```

Run it together with the API from the repository root:

```bash
pnpm dev:compose
```

## Boundaries

- Do not import `@media-engine/providers` in this app.
- Do not store provider API keys in browser code.
- Treat player availability as best-effort data returned by the API.
- Keep UI behavior focused on demonstrating the SDK and API contract, not hiding provider-quality issues.
