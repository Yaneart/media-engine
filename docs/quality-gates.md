# Quality gates and live smoke policy

Media Engine separates deterministic repository checks from best-effort third-party network
checks. A provider outage must not make pull requests flaky, and a real contract regression must
not be hidden as an ordinary upstream warning.

Original-torrent deterministic tests additionally inject TorrServer outages across recovery,
control, metadata, selection, and stream phases, verify telemetry redaction, and repeatedly cycle
shared sessions to prove terminal records, references, and runtime entries are cleaned up. These
tests use local fakes and do not depend on public swarms.

## Original-torrent acceptance

With the Compose stack running and the API already built, two local smoke gates exercise the
pinned TorrServer without a public swarm:

```bash
docker compose exec -T api node scripts/original-torrent-range-smoke.mjs
docker compose exec -T api node scripts/original-torrent-range-smoke.mjs --single-file
pnpm smoke:torrent-browser
```

The Range smoke uses a deterministic local tracker and peer. It verifies a multi-file torrent,
extension-independent selection, exact start/middle/tail and repeated ranges, concurrent ranges,
client cancellation, and ownership-safe cleanup. Unit coverage separately injects slow metadata,
first-piece delay, missing pieces, no peers, stalled bodies, stop, expiry, runtime replacement, and
concurrent-session pressure.

The browser smoke requires Firefox on the host. It creates a short VP8/Opus WebM with browser
`MediaRecorder`, keeps it only in memory, and streams it through the same local torrent path. It
checks native playback, decoded video dimensions, an audio track, a meaningful seek, the same bytes
under an unusual extension, honest rejection of healthy non-media bytes, and final cleanup. A
headless run proves the audio track reaches the decoder, not that sound was physically audible.
No probe, FFmpeg, remux, transcode, generated HLS, or stored media fixture is involved.

Before a release, manually repeat the example-player flow in current Firefox and Chromium: visible
video, audible audio, buffering state, start/middle/tail and repeated seeks, Stop, release switch,
unsupported-format messaging, tab/page cleanup, and TorrServer-down behavior. When TorrServer is
down, the only accepted result is `torrserver_unavailable`; there is no fallback player or engine.

## Deterministic CI

Every push and pull request installs the frozen pnpm lockfile and runs the complete
`pnpm release:check` gate on Node.js 24 (current LTS) and Node.js 26 (the repository development
runtime). That gate includes format, check-only lint, a hermetic clean build, type checks,
thresholded unit coverage, API e2e tests, release consistency, and dry-pack verification.

The three public packages are built once with the repository runtime, then their compiled test
suites and entrypoints run under the minimum documented Node.js 20 line. This deliberately avoids
requiring pnpm 11 under Node 20: the package manager is build tooling and requires Node.js 22.13,
while the published package runtime contract remains Node.js 20. Coverage is not evaluated in the
compatibility job because the deterministic built-in Node coverage filters require Node.js 22.8
or newer. The optional persisted IMDb SQLite adapter keeps its separately documented Node.js 22.13
minimum.

## Network smoke

Live provider checks run in a separate scheduled/manual workflow, never in the required pull
request gate. The scheduled full search matrix runs twice per week and permits at most four WARN
results out of its 17 canonical cases. This is a fixed operational budget: zero contract
regressions, while allowing transient degradation in fewer than one quarter of the cases. It is
not adjusted to make an individual bad provider run pass.

The existing latency budgets remain 5 seconds for search/details and 8 seconds for availability.
They are warning thresholds, not API timeout promises. A caller can make any smoke warning fatal
or supply a bounded allowance:

```bash
node scripts/search-quality-smoke.mjs --matrix full --strict
node scripts/search-quality-smoke.mjs --matrix full --fail-on-warn
node scripts/search-quality-smoke.mjs --matrix full --max-warnings 4
node scripts/search-quality-smoke.mjs --matrix full --max-warnings 4 --json
```

`--strict` is an alias for `--fail-on-warn`; both set the warning budget to zero. Without either
option, warnings are reported but tolerated. `--max-warnings N` accepts only a non-negative safe
integer. A `CONTRACT_REGRESSION` always exits non-zero regardless of the warning budget.

All smoke scripts emit the same JSON envelope with `--json`: schema version, smoke name, active
policy, classified results, counts, budget state, and the intended exit code. Classifications are:

- `HEALTHY`: the check passed;
- `UPSTREAM_DEGRADED`: an external provider failed or returned incomplete live data;
- `BUDGET_EXCEEDED`: a latency/performance threshold was exceeded;
- `CONTRACT_REGRESSION`: deterministic identity, type, shape, filtering, or other contract
  behavior was wrong.

The process exits non-zero after writing the JSON report when a contract regression exists or the
warning count is above the configured budget, so CI can always upload the report as an artifact.
