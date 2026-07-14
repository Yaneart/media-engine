# Post-0.1.0 Refactor and Quality Plan

## Status and Resume Point

Media Engine `0.1.0` is published and verified from the public npm registry:

- `@media-engine/core@0.1.0`;
- `@media-engine/providers@0.1.0`;
- `@media-engine/sdk@0.1.0`.

The release baseline is commit `ed19fbb` plus the already published repository state on `main`. At the time this plan was written, `main` was clean and synchronized with `origin/main`. The user may create and push the `v0.1.0` tag manually and should revoke the temporary npm publish token when it is no longer needed.

Resume implementation with **Documentation Block: Human, Bilingual READMEs**. Complete and commit the documentation block before starting Block 0. Do not start by moving production code immediately.

## Goal

Reduce the maintenance cost of the largest files without changing public APIs, search behavior, merge semantics, provider output, or runtime performance. Use the refactor to perform a focused audit of code quality, dead code, error handling, cancellation, caching, and hot-path performance.

This is an incremental refactor, not a rewrite.

## Non-Negotiable Rules

1. Work in medium-sized, commit-ready blocks and stop after each block for user review and manual commit.
2. Never stage, commit, push, publish, or tag for the user.
3. Keep the public root exports and package contracts backward compatible with `0.1.0`.
4. Keep `MediaEngine`, `DefaultMergeStrategy`, provider factories, and SDK entry points stable.
5. Do not combine file extraction with scoring, ranking, timeout, retry, cache, or provider behavior changes.
6. When an audit finds a behavior bug, fix it in a separate block with a regression test and an explicit before/after measurement.
7. Do not add browser/e2e infrastructure. Use focused unit tests, existing API tests, CLI smoke checks, Docker API checks, and user browser testing when needed.
8. Preserve unrelated user changes in a dirty worktree.

## Documentation Block: Human, Bilingual READMEs

Goal: explain the project in plain language before the architectural refactor starts.

The repository currently has six independent README files:

- root `README.md`: GitHub repository landing page;
- `packages/core/README.md`: npm/GitHub documentation for `@media-engine/core`;
- `packages/providers/README.md`: npm/GitHub documentation for `@media-engine/providers`;
- `packages/sdk/README.md`: npm/GitHub documentation for `@media-engine/sdk`;
- `apps/api/README.md`: internal API application guide;
- `apps/example/README.md`: internal example application guide.

Documentation structure:

1. Keep English in each `README.md` as the default international version.
2. Add a matching `README.ru.md` beside every README.
3. Put a visible `English | Русский` switch at the top of every file.
4. Keep translations structurally aligned, but write naturally in each language instead of translating word for word.
5. Keep the root README short and human:
   - what Media Engine does in one paragraph;
   - what problem it solves;
   - installation;
   - one minimal metadata example;
   - one metadata plus players example;
   - package map;
   - Docker quick start;
   - honest limitations;
   - links to deeper documentation.
6. Keep package READMEs package-specific. Do not repeat the whole architecture or large response payloads on every npm page.
7. Keep API/example READMEs focused on running, configuration, and boundaries.
8. Move detailed contracts, long response examples, implementation history, and contributor rules to `docs/` instead of the landing pages.
9. Verify every code example against the current public exports and `0.1.0` API.
10. Include `README.ru.md` in the three published package tarballs and confirm with `pnpm pack:check`.

Important npm behavior:

- GitHub renders the root `README.md` on the repository page and the local README inside each subdirectory.
- npm renders the `README.md` found at the root of each published package, so the three npm pages intentionally have different package-specific text.
- npm does not automatically render the repository root README for workspace packages.
- README changes appear on npm only after a new package version is published. Do not republish or bump versions as part of this documentation block unless the user explicitly chooses a release.

Quality rules:

- prefer short sentences and concrete examples;
- avoid corporate language, slogans, duplicated claims, and unexplained jargon;
- explain metadata providers and streaming providers separately;
- state clearly that live upstream providers are best-effort and may be unavailable;
- do not promise that every returned third-party player works everywhere;
- do not hide setup requirements or current limitations;
- keep commands copy-pasteable from the documented directory.

Verification:

1. Check all Markdown with Prettier.
2. Check every internal and language-switch link.
3. Typecheck or directly execute code examples where practical.
4. Run `pnpm pack:check` and inspect all three package tarballs.
5. Confirm root imports from clean packed/registry-style installs.
6. Run the quick search smoke once because README examples must still reflect real behavior; documentation edits do not require the after-every-source-patch search gate.

Stop after this documentation block for user review and manual commit. Suggested commit scope: human, bilingual project documentation. Start Block 0 only after that commit.

## Mandatory Search Safety Gate

Search must be checked after **every source-code patch**, even when the patch is intended to be a pure move.

Minimum gate after each patch:

1. Run the focused tests for every touched module.
2. Run the affected package typecheck.
3. Run the deterministic core search/merge regression tests.
4. Run the strict search-quality smoke against the current build.
5. Compare the canonical first result, media type, title language, description cleanliness, poster presence, source coverage, provider failures, and elapsed time with the baseline.

Required quick search cases after every patch:

- `one` -> `One Piece`;
- `ванпис` -> `Ван-Пис`;
- `game of` -> `Game of Thrones`;
- `game of throen` -> `Game of Thrones`;
- `house of the dragon` -> `House of the Dragon`;
- untyped `dark` -> `Dark` (2017 series);
- `attack on titan` -> canonical anime;
- `интерстеллар` -> `Интерстеллар`.

At the end of every commit-ready block, run the full live matrix:

- `one`, `one piece`, `ванпис`;
- `game of`, `game of thrones`, `game of throen`;
- `house of the dragon`;
- `avatar`, `dune`, `dark`;
- `attack on titan`, `death note`, `fullmetal alchemist`, `spirited away`;
- `интерстеллар`, `во все тяжкие`, `клан сопрано`.

For sampled One Piece, Game of Thrones, Dark, and Interstellar results, compare search and details titles and exact poster URLs. Record transient upstream failures separately from deterministic regressions. A retry may diagnose an upstream transient, but the first failure must not be hidden.

If a patch breaks search, stop, identify the exact cause, and either correct the same patch or revert only that patch before continuing. Do not stack more refactoring on a red search baseline.

## Block 0: Baseline and Regression Harness

Goal: make regressions measurable before moving code.

Tasks:

1. Confirm clean worktree and record the current commit.
2. Record line counts and module/function outlines for the largest files.
3. Record targeted coverage for:
   - core engine;
   - merge strategy;
   - KinoBD streaming.
4. Record baseline timings:
   - deterministic synthetic merge benchmark;
   - strict search quality and search latency;
   - details latency;
   - availability latency.
5. Expand or add a CLI search regression harness for the required quick and full matrices so checks are repeatable and machine-readable.
6. Ensure the harness distinguishes `PASS`, upstream `WARN`, and deterministic `FAIL`.
7. Store concise baseline results in project memory, not generated benchmark artifacts in the repository.

Done when the same baseline can be rerun after every extraction and canonical search identity is asserted, not judged only by non-empty output.

Stop for the user's manual commit if the regression harness changes repository files.

## Block 1: Split the Merge Strategy

Current hotspot: `packages/core/src/merge/strategy.ts` (approximately 1,650 lines at planning time).

Target structure may be adjusted to avoid circular dependencies, but responsibilities should become explicit:

- `merge/search-grouping.ts`: group construction, indexes, and compatibility checks;
- `merge/details-identity.ts`: strong-ID compatibility and conflicting-details filtering;
- `merge/title-matching.ts`: normalization, fuzzy token matching, transpositions, and edit distance;
- `merge/scoring.ts`: title relevance, authority, popularity, rating, and coverage scoring;
- `merge/field-selection.ts`: localized titles/descriptions, images, IDs, genres, ratings, and sources;
- `merge/strategy.ts`: small `DefaultMergeStrategy` orchestration facade.

Sequence:

1. Extract shared internal types and constants without behavior changes.
2. Extract title normalization/matching and run the mandatory search gate.
3. Extract scoring and run the mandatory search gate plus synthetic performance comparison.
4. Extract grouping/identity and run search plus details identity regressions.
5. Extract field selection and compare search/details localization and posters.
6. Split the large strategy test file along the same responsibility boundaries.

Audit while working:

- accidental quadratic scans and sorts;
- duplicate normalization or array creation in scoring loops;
- unstable ordering and hidden provider-priority coupling;
- weak-ID and strong-ID conflict handling;
- unreachable fallbacks and unused helpers;
- allocations that can be replaced with bounded maps/sets without changing behavior.

Any performance or behavior optimization discovered here must be implemented in a separate follow-up block after the pure extraction is committed.

## Block 2: Split the Core Engine

Current hotspot: `packages/core/src/engine/engine.ts` (approximately 1,400 lines at planning time).

Target responsibilities:

- `engine/query.ts`: normalization, validation, language inference, and cache-key input normalization;
- `engine/provider-execution.ts`: provider calls, cancellation, timeouts, retry, timings, and failure mapping;
- `engine/search-enrichment.ts`: ID enrichment, canonical poster enrichment, and bounded fallbacks;
- `engine/availability.ts`: streaming-provider selection and availability/episode merging;
- `engine/cache.ts`: cache keys and expiring availability TTL calculation;
- `engine/engine.ts`: public `MediaEngine` orchestration only.

Audit while working:

- sequential work accidentally added to provider fan-out;
- retry budgets exceeding total timeout budgets;
- abort signals not propagated through backoff or nested requests;
- cache-key collisions, mutable cached data, or details-cache contamination;
- duplicate provider calls during enrichment;
- large result fan-out or unbounded limits;
- response ordering changes caused by concurrency.

After every extraction, run the mandatory search gate. Also compare cold and cached search timings. No extraction may regress the median deterministic benchmark materially; investigate changes above 10% before continuing.

## Block 3: Split KinoBD Streaming

Current hotspot: `packages/providers/src/kinobd-streaming/index.ts` (approximately 1,380 lines at planning time).

Target responsibilities:

- provider factory, configuration, and capabilities;
- KinoBD/Shikimori HTTP client calls;
- candidate search, identity matching, and selection;
- player payload parsing and option mapping;
- bounded player validation and broken-player filtering;
- translation language/type/team inference;
- small shared parsing utilities.

Audit while working:

- SSRF/public-URL checks on every upstream-discovered URL;
- response-size limits and validation concurrency;
- timeout and abort propagation;
- false-positive broken-player filters;
- title-only fallback selecting the wrong media;
- episode mapping and expiring URL handling;
- duplicated parsing and inconsistent normalization.

Run provider unit tests and availability smokes after every patch. Also run the mandatory search gate because provider exports and shared types must not destabilize the API build or search configuration.

## Block 4: Example UI and Test Structure

Split `apps/example/src/App.tsx` into focused components/hooks without changing visible behavior:

- search state and request cancellation;
- details state;
- availability/episode selection state;
- search, details, availability, and player presentation components;
- formatting helpers.

Split oversized test files by responsibility so their location follows the extracted production modules. Avoid duplicating fixtures or weakening assertions merely to reduce line counts.

After every patch, run example typecheck/build and the mandatory search gate. The user performs browser testing when a complete UI block is ready.

## Block 5: Code-Quality and Dead-Code Audit

Enable or enforce `noUnusedLocals` and `noUnusedParameters` for all TypeScript packages after file movement settles. Remove code only when usage analysis, compiler diagnostics, tests, and public-export review agree that it is unused.

Audit checklist:

- unused locals, parameters, imports, exports, and stale configuration;
- package export surface versus documented public API;
- circular module dependencies;
- duplicated helpers and inconsistent normalization;
- oversized functions, deep nesting, and mixed abstraction levels;
- unsafe casts and lost error metadata;
- missing cancellation and resource bounds;
- cache ownership and mutation isolation;
- logging/debug paths that expose sensitive upstream data;
- dependency advisories and unnecessary dependencies.

Do not remove a public export only because the monorepo does not import it; published consumers may use it. Public API removals require a versioned deprecation plan.

## Block 6: Performance Audit and Focused Fixes

Perform this after pure structural refactors are committed so performance changes have a clean baseline.

Measure and inspect:

- merge throughput for 2,000+ provider results;
- exact and fuzzy title matching hot paths;
- cold versus cached search;
- provider fan-out concurrency;
- enrichment critical path and duplicate details calls;
- IMDb dataset build/search memory and latency;
- availability validation concurrency and total timeout;
- cache size, TTL, cloning cost, and concurrent identical misses.

Prioritize fixes only when supported by measurements. Each optimization gets:

1. a before benchmark;
2. a focused regression test;
3. the mandatory search gate;
4. an after benchmark;
5. a separate user-reviewed commit.

Known deferred candidate: coalescing concurrent identical cache misses. Treat it as a separate lifecycle-design change, not as incidental cleanup.

## Block 7: Final Verification

Run after all accepted refactor/audit blocks:

```bash
pnpm release:check
pnpm pack:check
pnpm audit --audit-level high
node scripts/provider-smoke.mjs --strict
node scripts/availability-smoke.mjs --strict
node scripts/search-quality-smoke.mjs --strict
node scripts/search-latency-smoke.mjs --strict
node scripts/details-latency-smoke.mjs --strict
node scripts/availability-latency-smoke.mjs --strict
```

Then fully recreate Docker Compose and verify:

- API health and example availability;
- all public routes;
- the full search matrix;
- sampled search/details poster equality;
- representative movie, series episode, and anime availability;
- clean API/example logs.

Compare results to the Block 0 baseline. Structural cleanup is complete only when behavior remains compatible, search quality does not regress, and performance is equal or better within expected upstream variance.

## Next Session Checklist

1. Read project memory and this plan.
2. Confirm whether `v0.1.0` was pushed and the npm publish token was revoked; these do not block code refactoring.
3. Check `git status` and do not touch unrelated changes.
4. Start the Documentation Block only.
5. Rewrite the six English READMEs and add their six natural Russian counterparts.
6. Verify links, examples, package contents, and one quick live search smoke.
7. Stop for user review/manual commit.
8. In the following block, build the repeatable quick/full search regression harness before moving production code.
