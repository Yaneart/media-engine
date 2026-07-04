# Release Preparation

## Scope

This document defines the release baseline for `TASK-102`.

Release preparation covers:

- package metadata;
- license and changelog;
- local release checks;
- npm packing checks;
- manual publish steps.

It does not publish packages automatically.

## Publishable Packages

The publishable packages are:

- `@media-engine/core`;
- `@media-engine/providers`;
- `@media-engine/sdk`.

The private workspace packages are:

- root `media-engine`;
- `@media-engine/api`;
- `@media-engine/example`.

## Versioning

Current package versions remain:

```txt
0.0.0
```

Before publishing, choose the release version explicitly and update all publishable package versions together.

For a pre-v1 release, use a version such as:

```txt
0.1.0
```

After `v1.0`, follow semantic versioning:

- patch for compatible fixes;
- minor for compatible new features;
- major for breaking changes.

## Required Checks

Run the full release gate before packing or publishing:

```bash
pnpm release:check
```

This runs:

```bash
pnpm format:check
pnpm build
pnpm typecheck
pnpm test
```

## Provider Smoke Checks

Run live provider smoke checks before packing or publishing:

```bash
pnpm smoke:providers
```

This command builds the packages and runs the golden parser queries from `docs/14-parser-release-hardening.md` against live providers.

For release-blocking behavior:

```bash
pnpm smoke:providers -- --strict
```

Strict mode exits non-zero when required parser expectations fail. Keep this check separate from `pnpm release:check` because live third-party providers can be rate-limited or temporarily unavailable.

## Pack Checks

After a successful release gate, verify npm package contents without publishing:

```bash
mkdir -p /tmp/media-engine-pack
pnpm --filter @media-engine/core pack --pack-destination /tmp/media-engine-pack
pnpm --filter @media-engine/providers pack --pack-destination /tmp/media-engine-pack
pnpm --filter @media-engine/sdk pack --pack-destination /tmp/media-engine-pack
```

Inspect the tarballs:

```bash
tar -tf /tmp/media-engine-pack/media-engine-core-*.tgz
tar -tf /tmp/media-engine-pack/media-engine-providers-*.tgz
tar -tf /tmp/media-engine-pack/media-engine-sdk-*.tgz
```

Each package should contain:

- `package.json`;
- `README.md`;
- compiled `dist/*.js`;
- generated `dist/*.d.ts`;
- source maps if emitted by TypeScript.

Packages should not contain:

- `src`;
- tests;
- local env files;
- app build outputs;
- workspace-only config files.

## Publish Checklist

Before publishing:

- confirm package names and npm scope ownership;
- choose and update the release version;
- update `CHANGELOG.md`;
- run `pnpm release:check`;
- run `pnpm smoke:providers`;
- run pack checks;
- review package tarball contents;
- commit release preparation manually;
- create a git tag manually if releasing from git.

Publish commands, run manually by the project owner:

```bash
pnpm --filter @media-engine/core publish --access public
pnpm --filter @media-engine/providers publish --access public
pnpm --filter @media-engine/sdk publish --access public
```

Do not publish `apps/api`, `apps/example`, or the workspace root.
