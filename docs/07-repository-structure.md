# Media Engine Repository Structure

## Package Manager

The project uses `pnpm`.

Reasons:

- good monorepo support;
- strict dependency layout;
- fast installs;
- simple workspace commands.

## Root Structure

```txt
media-engine/
  packages/
    core/
    providers/
    plugins/
    sdk/
  apps/
    api/
    example/
  docs/
  tooling/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  eslint.config.js
  prettier.config.js
  README.md
  LICENSE
  CHANGELOG.md
```

## Workspace

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

## Root Scripts

Expected root scripts:

```json
{
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "typecheck": "pnpm -r typecheck",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "dev:api": "pnpm --filter @media-engine/api start:dev",
  "dev:example": "pnpm --filter @media-engine/example dev",
  "dev:compose": "docker compose up",
  "dev:compose:down": "docker compose down"
}
```

## TypeScript

Root `tsconfig.base.json` should use strict TypeScript and ESM-first output.

Baseline:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

## `packages/core`

Package: `@media-engine/core`

Owns:

- engine;
- public types;
- provider contracts;
- registry;
- merge;
- errors;
- cache interfaces;
- testing utilities.

Suggested structure:

```txt
packages/core/
  src/
    engine/
    providers/
    search/
    details/
    media/
    merge/
    errors/
    cache/
    testing/
    index.ts
  test/
  package.json
  tsconfig.json
  README.md
```

Forbidden:

- import `@media-engine/providers`;
- import NestJS;
- import React;
- read env directly.

## `packages/providers`

Package: `@media-engine/providers`

Owns:

- provider factories;
- external clients;
- mappers;
- provider-specific config;
- provider tests.

Suggested structure:

```txt
packages/providers/
  src/
    experimental-streaming/
    tmdb/
    shikimori/
    shared/
    index.ts
  test/
  package.json
  tsconfig.json
  README.md
```

## `packages/plugins`

Reserved for future plugin contracts and optional extensions.

Not implemented in the current release baseline.

## `packages/sdk`

Package: `@media-engine/sdk`

Owns:

- typed REST API client;
- request serialization;
- response parsing;
- SDK error model;
- framework-independent browser and Node.js usage.

## `apps/api`

Package: `@media-engine/api`

Technology: NestJS + TypeScript.

Owns:

- REST API;
- DTOs;
- validation;
- provider configuration;
- Swagger;
- health checks.

It must not own provider HTTP clients or merge logic.

## `apps/example`

Package: `@media-engine/example`

Technology: React + TypeScript. Vite is preferred for a simple demo unless later requirements justify Next.js.

It must call API or SDK, not provider packages.

## Naming

Files: `kebab-case.ts`.

Types/classes: `PascalCase`.

Functions/variables: `camelCase`.

Provider names: lowercase stable identifiers like `tmdb`, `shikimori`, `kinopoisk`.

## Build Output

Packages build to `dist/` and publish compiled JS, `.d.ts`, README, and package metadata.

## Versioning

Before `v1.0`, public API may change if docs are updated.

After `v1.0`, use semver.
