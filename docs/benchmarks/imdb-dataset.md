# IMDb dataset backend baseline

This benchmark defines the Block 14A contract and measurable acceptance criteria for the persisted IMDb backend. It is not part of the normal test or release gate.

Run it from the repository root:

```bash
pnpm benchmark:imdb-dataset -- --sizes 100000,1000000 --iterations 10 --warmup-iterations 2
```

Use `--json` for machine-readable output. Each size runs in a fresh worker. The script generates only supported `movie`/`tvSeries` rows, adds a rating to one third of them, measures provider construction, and then measures direct ID, exact title, prefix/substring, and misspelled-title miss queries. One million supported records approximate the retained full-scale subset more accurately than filling the fixture with title types this provider discards.

Heap numbers exclude the already-generated raw fixture strings. Retained heap is measured after forced garbage collection; peak heap is sampled every 5 ms during synchronous provider construction. The fuzzy case is explicitly an unsupported miss baseline: the current adapter has exact and substring matching but no edit-distance search.

## 14A baseline

Captured on 2026-07-21 with Node.js v26.4.0 on Linux x64, Intel Core i5-8250U, 16 GB RAM. Query values are ten measured iterations after two warmups.

| Metric                  |       100k rows |           1m rows |
| ----------------------- | --------------: | ----------------: |
| Fixture size            |        8.40 MiB |         86.24 MiB |
| Startup                 |          881 ms |            5.22 s |
| Retained heap delta     |       53.87 MiB |        526.00 MiB |
| Sampled peak heap delta |       76.34 MiB |        546.62 MiB |
| ID lookup p50 / p95     |  0.06 / 0.26 ms |    0.05 / 0.16 ms |
| Exact title p50 / p95   | 6.33 / 14.88 ms |  43.15 / 69.41 ms |
| Prefix title p50 / p95  | 9.15 / 20.68 ms | 77.32 / 105.99 ms |
| Fuzzy miss p50 / p95    |  5.51 / 7.45 ms |  41.04 / 43.50 ms |

The result confirms the expected shape: direct `Map` ID lookup stays constant, while startup, retained heap, and every title query grow with the number of retained rows. The storage contract introduced in 14A preserves the in-memory adapter for fixtures while moving these operations behind `getTitleById` and `searchTitles`.

## Block 14B acceptance

The persisted implementation must pass the same generated 100k/1m workload and the existing provider contract tests. On the reference environment, excluding the one-time index import:

- opening an existing one-million-row index must take at most 500 ms;
- provider retained and sampled peak JavaScript heap deltas must each stay at or below 128 MiB;
- ID lookup p95 must stay at or below 2 ms;
- exact, prefix, and misspelled-title miss p95 must each stay at or below 20 ms at one million rows;
- title-query p95 may grow by no more than 2x when moving from 100k to 1m rows;
- the import must stream input instead of accepting full TSV strings, use a versioned schema, publish the completed index atomically, and stay below 128 MiB JavaScript heap above its streaming buffers;
- an interrupted or invalid import must leave the previous valid index usable;
- the persisted index must remain no larger than four times the generated TSV input;
- the original TSV provider options and small-fixture behavior must remain backward compatible.

Machine variance is handled by the relative scaling and memory requirements. If a hard latency threshold misses on a materially slower host, the result must still demonstrate indexed scaling and a clear improvement over that host's 14A baseline; thresholds must not be silently weakened.
