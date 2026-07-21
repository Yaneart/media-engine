# Versioning and package builds

Media Engine keeps three version concepts separate:

- The public npm release version belongs to `@media-engine/core`, `@media-engine/providers`, and
  `@media-engine/sdk`. These packages are released together and must have the same version.
  `MEDIA_ENGINE_CORE_VERSION` is the runtime form of that package version.
- `MEDIA_ENGINE_API_CONTRACT_VERSION` identifies the REST/OpenAPI contract. It changes when the
  HTTP contract changes and does not need to follow every npm package patch.
- Default provider and repository smoke-test User-Agent strings identify the public package
  release that produced the client. They are not the API contract version.

The root manifest and the private API/example workspace manifests intentionally remain at
`0.0.0`: they are not published packages, and their manifest versions are neither a release
number nor an API contract number.

`pnpm build` cleans only each public package's own `dist` directory before TypeScript emits. Use
`pnpm build:check` to seed a deleted-module fixture, build from clean output, and compare every
source file with its expected JavaScript, declaration, and source-map artifacts. `pnpm pack:check`
also compares each dry-run tarball with the production source inventory so tests, test helpers,
and stale modules cannot be published.

Before a release, the consistency check verifies the three public manifests, internal workspace
dependencies, built runtime constants, the latest released changelog heading, the independently
named API contract version, and production User-Agent defaults. It runs as part of
`pnpm release:check` and `pnpm pack:check`.

`pnpm release:check` builds once and then reuses those clean outputs for type checks, thresholded
coverage, API e2e, release consistency, and dry-pack verification. Package-level `test` and
`coverage` scripts remain standalone and build their own package first; their internal `test:unit`
and `coverage:unit` forms intentionally consume existing output. Node test files are derived only
from current `src/**/*.test.ts` files, and coverage explicitly excludes compiled tests and test
helpers, so deleted or stale `dist` files cannot enter the gate. Built-in coverage include/exclude
filters and thresholds require Node.js 22.8 or newer, independently of the packages' Node.js 20
runtime baseline.
