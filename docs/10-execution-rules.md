# Media Engine Execution Rules

## Main Rule

Development follows the backlog in order:

```txt
TASK-000 -> TASK-001 -> TASK-002 -> ...
```

Do not move to the next task until the current task satisfies `Done When` and required checks.

## Before Code

Before the first code task, these documents must be agreed:

- project charter;
- product scope;
- architecture;
- public API;
- data model;
- provider system;
- merge strategy;
- repository structure;
- roadmap;
- task backlog;
- execution rules.

Code starts only after an explicit decision such as:

```txt
Start TASK-001
```

## One Task at a Time

Only one task is active at a time.

If the active task is `TASK-005: Implement ProviderRegistry`, do not also add TMDB, NestJS, React, streaming, or unrelated refactors.

## Task Workflow

```txt
1. Read current task.
2. Check related docs.
3. Identify allowed files.
4. Explain the intended change before code.
5. Implement only the task, or show code for the user to type manually if requested.
6. Run checks.
7. Fix failures.
8. Verify Done When.
9. Summarize result.
10. Update project memory with what changed and where to resume.
```

## Allowed Changes

`Allowed Changes` defines the allowed edit area.

Changing files outside that list requires an explicit reason and, if architectural, a documentation update first.

## Not Allowed

`Not Allowed` is binding. Helpful but premature work is still forbidden.

If a task says no real providers, do not add real providers.

## Definition of Done for a Task

A task is done when:

- all requirements are implemented;
- forbidden changes were not made;
- checks pass or a clear reason is recorded;
- tests exist where appropriate;
- docs match behavior;
- no known regression remains.

## Architecture Changes

Architecture can change, but only explicitly.

Process:

```txt
1. Explain the issue.
2. Propose the change.
3. Update the relevant doc.
4. Update the code.
```

Do not make architecture changes silently in code.

## Public API Changes

Public API changes go through `03-public-api.md`.

This includes:

- method names;
- query shape;
- response shape;
- error model;
- provider registration.

## Data Model Changes

Data model changes go through `04-data-model.md`.

This includes:

- `MediaItem`;
- `MediaDetails`;
- `ExternalIds`;
- `Rating`;
- `Season`;
- `Episode`;
- `Person`.

## Provider Contract Changes

Provider contract changes go through `05-provider-system.md`.

This includes:

- `MediaProvider`;
- `ProviderCapabilities`;
- provider result types;
- provider errors.

## Merge Changes

Merge logic changes go through `06-merge-strategy.md`.

This includes:

- match rules;
- provider priority;
- conflict behavior;
- score calculation;
- warnings.

## Repository Changes

Repository structure changes go through `07-repository-structure.md`.

New packages or apps require documentation first.

## Premature Feature Ban

Before v0.1 is complete, do not add:

- TMDB provider;
- Shikimori provider;
- Kinopoisk provider;
- NestJS API;
- React app;
- streaming providers;
- database;
- auth;
- SDK.

Before v0.2 is complete, do not add frontend as the main product.

Before v0.3 is complete, do not make example app depend on core internals.

## Error Handling

Errors must be predictable.

Do not:

- throw random raw errors from public API;
- swallow provider failures silently;
- fail the whole search because one provider failed if other providers succeeded;
- return unclear error shapes.

Use:

- `MediaEngineError`;
- `ProviderError`;
- `meta.providers.failed`;
- `EngineWarning`.

## Tests

Core uses unit tests and mock providers.

Providers use mapper tests and mock HTTP.

Live API tests are optional and disabled by default.

API uses controller, validation, and e2e tests.

UI uses basic integration/manual checks.

## Learning Mode

The user is learning the architecture and implementation.

Default behavior for code tasks:

- explain the purpose of each file before showing code;
- explain why each type/function exists;
- prefer small steps over large code dumps;
- show code snippets when the user wants to type the code manually;
- edit files directly only when the user explicitly asks Codex to apply changes.

Documentation tasks may be edited directly when the user asks Codex to refine the plan or docs.

## Environment Variables

Core does not read environment variables.

Env may be read in:

- apps;
- provider setup layer;
- test setup;
- local examples.

Never commit real API keys.

## Commits

Prefer commits by completed task or logical part of a task.

Examples:

```txt
feat(core): add provider registry
test(core): cover merge strategy
docs: add architecture
```

Do not mix unrelated core, API, UI, and docs changes in one commit.

Codex must never run `git add`, `git commit`, or `git push`. The user handles staging, commits, and pushes manually.

## New Ideas

New ideas are recorded, assigned to a version, and added to roadmap/backlog. They are not implemented immediately unless they belong to the active task.

## External Examples

Projects like AnimeParsers may inspire provider ideas, but Media Engine remains:

- TypeScript-first;
- engine-first;
- provider-based;
- framework-independent in core;
- NestJS only in the API app.

## Final Rule

When unsure:

```txt
Read the current task.
Read Allowed Changes.
Read Done When.
Do not jump forward.
```
