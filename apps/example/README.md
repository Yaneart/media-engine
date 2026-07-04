# @media-engine/example

React example app for Media Engine.

The app demonstrates browser usage through `@media-engine/sdk`. It calls the NestJS API and does not import provider packages or store provider API keys in the browser.

## Scripts

```bash
pnpm --filter @media-engine/example dev
pnpm --filter @media-engine/example build
pnpm --filter @media-engine/example typecheck
```

The app is API-facing. It must not import provider packages or store provider API keys in the browser.
