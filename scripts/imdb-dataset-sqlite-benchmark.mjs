#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";

const DEFAULT_SIZES = [100_000, 1_000_000];
const DEFAULT_ITERATIONS = 10;
const DEFAULT_WARMUP_ITERATIONS = 2;
const HEAP_SAMPLE_INTERVAL_MS = 5;
const MEBIBYTE = 1024 * 1024;

if (isMainThread) {
  await runCoordinator();
} else if (workerData.mode === "build") {
  await runBuildWorker();
} else {
  await runQueryWorker();
}

async function runCoordinator() {
  const sizes = readSizes("--sizes", DEFAULT_SIZES);
  const iterations = readPositiveInteger("--iterations", DEFAULT_ITERATIONS);
  const warmupIterations = readNonNegativeInteger("--warmup-iterations", DEFAULT_WARMUP_ITERATIONS);
  const json = process.argv.includes("--json");
  const results = [];

  for (const size of sizes) {
    results.push(await benchmarkSize(size, iterations, warmupIterations));
  }

  const scaling = evaluateScaling(results);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    implementation: "IMDb persisted SQLite/FTS adapter",
    heapSamplingIntervalMs: HEAP_SAMPLE_INTERVAL_MS,
    environment: {
      node: process.version,
      sqlite: process.versions.sqlite,
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    benchmark: {
      iterations,
      warmupIterations,
      sizes: results,
      scaling,
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exitCode = results.every((result) => result.acceptance.passed) && scaling.passed ? 0 : 1;
}

async function benchmarkSize(size, iterations, warmupIterations) {
  const directory = await mkdtemp(join(os.tmpdir(), "media-engine-imdb-benchmark-"));
  const titleBasicsPath = join(directory, "title.basics.tsv");
  const titleRatingsPath = join(directory, "title.ratings.tsv");
  const outputPath = join(directory, "imdb.sqlite");

  try {
    const build = await runMeasuredWorker({
      mode: "build",
      size,
      titleBasicsPath,
      titleRatingsPath,
      outputPath,
    });
    const query = await runMeasuredWorker({
      mode: "query",
      size,
      iterations,
      warmupIterations,
      outputPath,
    });
    const indexToFixtureRatio = build.result.indexBytes / build.result.fixtureBytes;
    const acceptance = evaluateAcceptance(size, build, query, indexToFixtureRatio);

    return {
      rows: size,
      ratingRows: build.result.ratingRows,
      fixtureBytes: build.result.fixtureBytes,
      indexBytes: build.result.indexBytes,
      indexToFixtureRatio,
      importMs: build.result.importMs,
      importPeakHeapDeltaBytes: build.peakHeapDeltaBytes,
      openMs: query.result.openMs,
      openRetainedHeapDeltaBytes: query.result.retainedHeapBytes - query.baselineHeapBytes,
      openPeakHeapDeltaBytes: query.peakHeapDeltaBytes,
      queries: query.result.queries,
      acceptance,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runMeasuredWorker(data) {
  const worker = new Worker(new URL(import.meta.url), { workerData: data });

  try {
    const readyPromise = waitForMessage(worker, "ready");
    await waitForWorkerOnline(worker);
    const ready = await readyPromise;
    const heapSamples = [ready.baselineHeapBytes];
    let sampling = true;
    const sampler = sampleWorkerHeap(worker, heapSamples, () => sampling);
    const resultPromise = waitForMessage(worker, "complete");
    worker.postMessage({ type: "start" });
    const result = await resultPromise;
    sampling = false;
    await sampler;
    const finalHeap = await worker.getHeapStatistics();
    heapSamples.push(finalHeap.used_heap_size);
    worker.postMessage({ type: "stop" });

    return {
      baselineHeapBytes: ready.baselineHeapBytes,
      peakHeapDeltaBytes: Math.max(0, Math.max(...heapSamples) - ready.baselineHeapBytes),
      result,
    };
  } finally {
    await worker.terminate();
  }
}

async function runBuildWorker() {
  const { buildImdbDatasetSqliteIndex } =
    await import("../packages/providers/dist/imdb-dataset/index.js");
  const { size, titleBasicsPath, titleRatingsPath, outputPath } = workerData;
  const fixture = await createFixtureFiles(size, titleBasicsPath, titleRatingsPath);
  collectGarbage();
  parentPort.postMessage({ type: "ready", baselineHeapBytes: process.memoryUsage().heapUsed });
  await waitForParentMessage("start");
  const result = await buildImdbDatasetSqliteIndex({
    titleBasicsPath,
    titleRatingsPath,
    outputPath,
  });

  parentPort.postMessage({
    type: "complete",
    fixtureBytes: fixture.fixtureBytes,
    ratingRows: fixture.ratingRows,
    indexBytes: result.indexBytes,
    importMs: result.durationMs,
  });
  await waitForParentMessage("stop");
}

async function runQueryWorker() {
  const { imdbDatasetProvider, openImdbDatasetSqliteStorage } =
    await import("../packages/providers/dist/imdb-dataset/index.js");
  const { size, iterations, warmupIterations, outputPath } = workerData;
  collectGarbage();
  parentPort.postMessage({ type: "ready", baselineHeapBytes: process.memoryUsage().heapUsed });
  await waitForParentMessage("start");
  const startedAt = performance.now();
  const storage = await openImdbDatasetSqliteStorage({ path: outputPath });
  const provider = imdbDatasetProvider({ storage });
  const openMs = performance.now() - startedAt;
  collectGarbage();
  const retainedHeapBytes = process.memoryUsage().heapUsed;
  const queries = {};

  try {
    for (const [name, query] of Object.entries(createQueries(size))) {
      for (let index = 0; index < warmupIterations; index += 1) {
        await provider.search(query, {});
      }

      const samples = [];
      let resultCount = 0;

      for (let index = 0; index < iterations; index += 1) {
        const queryStartedAt = performance.now();
        const results = await provider.search(query, {});
        samples.push(performance.now() - queryStartedAt);
        resultCount = results.length;
      }

      queries[name] = { ...summarize(samples), resultCount };
    }
  } finally {
    storage.close();
  }

  parentPort.postMessage({
    type: "complete",
    openMs,
    retainedHeapBytes,
    queries,
  });
  await waitForParentMessage("stop");
}

async function createFixtureFiles(size, titleBasicsPath, titleRatingsPath) {
  const basics = createWriteStream(titleBasicsPath, { encoding: "utf8" });
  const ratings = createWriteStream(titleRatingsPath, { encoding: "utf8" });
  basics.write(
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n",
  );
  ratings.write("tconst\taverageRating\tnumVotes\n");
  const exactIndex = size - 1;
  let ratingRows = 0;

  for (let index = 0; index < size; index += 1) {
    const imdbId = createImdbId(index);
    const type = index % 5 === 0 ? "tvSeries" : "movie";
    const title =
      index === exactIndex
        ? `Benchmark Exact ${size}`
        : index % 10_000 === 0
          ? `Benchmark Target ${index}`
          : `Synthetic Title ${index}`;
    const year = 1950 + (index % 75);

    if (
      !basics.write(
        `${imdbId}\t${type}\t${title}\t${title}\t0\t${year}\t\\N\t${80 + (index % 80)}\tDrama\n`,
      )
    ) {
      await once(basics, "drain");
    }

    if (index % 3 === 0 || index === exactIndex) {
      if (!ratings.write(`${imdbId}\t${(5 + (index % 45) / 10).toFixed(1)}\t${100 + index}\n`)) {
        await once(ratings, "drain");
      }
      ratingRows += 1;
    }
  }

  basics.end();
  ratings.end();
  await Promise.all([finished(basics), finished(ratings)]);
  const [basicsStat, ratingsStat] = await Promise.all([
    stat(titleBasicsPath),
    stat(titleRatingsPath),
  ]);

  return { fixtureBytes: basicsStat.size + ratingsStat.size, ratingRows };
}

function createQueries(size) {
  return {
    id: { ids: { imdb: createImdbId(size - 1) } },
    exact: { title: `Benchmark Exact ${size}` },
    prefix: { title: "Benchmark Target" },
    fuzzyMiss: { title: `Benchmrak Excat ${size}` },
  };
}

function createImdbId(index) {
  return `tt${String(index + 1).padStart(8, "0")}`;
}

function evaluateAcceptance(size, build, query, indexToFixtureRatio) {
  const checks = {
    importHeap: build.peakHeapDeltaBytes <= 128 * MEBIBYTE,
    openTime: size < 1_000_000 || query.result.openMs <= 500,
    openRetainedHeap: query.result.retainedHeapBytes - query.baselineHeapBytes <= 128 * MEBIBYTE,
    openPeakHeap: query.peakHeapDeltaBytes <= 128 * MEBIBYTE,
    idP95: query.result.queries.id.p95Ms <= 2,
    exactP95: query.result.queries.exact.p95Ms <= 20,
    prefixP95: query.result.queries.prefix.p95Ms <= 20,
    fuzzyMissP95: query.result.queries.fuzzyMiss.p95Ms <= 20,
    indexSize: indexToFixtureRatio <= 4,
  };

  return { passed: Object.values(checks).every(Boolean), checks };
}

function evaluateScaling(results) {
  const smaller = results.find((result) => result.rows === 100_000);
  const larger = results.find((result) => result.rows === 1_000_000);

  if (!smaller || !larger) {
    return { passed: true, measured: false, p95Growth: {} };
  }

  const p95Growth = Object.fromEntries(
    ["exact", "prefix", "fuzzyMiss"].map((name) => [
      name,
      larger.queries[name].p95Ms / smaller.queries[name].p95Ms,
    ]),
  );

  return {
    passed: Object.values(p95Growth).every((growth) => growth <= 2),
    measured: true,
    p95Growth,
  };
}

async function sampleWorkerHeap(worker, samples, shouldContinue) {
  while (shouldContinue()) {
    try {
      const statistics = await worker.getHeapStatistics();
      samples.push(statistics.used_heap_size);
    } catch (error) {
      if (error?.code !== "ERR_WORKER_NOT_RUNNING") {
        throw error;
      }
      return;
    }

    await delay(HEAP_SAMPLE_INTERVAL_MS);
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    averageMs: sorted.length ? sum / sorted.length : 0,
  };
}

function percentile(sorted, quantile) {
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

function printReport(report) {
  console.log(
    `IMDb SQLite benchmark (${report.environment.node}, SQLite ${report.environment.sqlite}, ${report.environment.cpu})`,
  );

  for (const result of report.benchmark.sizes) {
    console.log(`\n${result.rows.toLocaleString("en-US")} title rows`);
    console.log(
      `  import=${result.importMs.toFixed(2)}ms importPeakHeap=${formatBytes(result.importPeakHeapDeltaBytes)}`,
    );
    console.log(
      `  index=${formatBytes(result.indexBytes)} ratio=${result.indexToFixtureRatio.toFixed(2)}x open=${result.openMs.toFixed(2)}ms`,
    );
    console.log(
      `  openHeap retained=${formatBytes(result.openRetainedHeapDeltaBytes)} peak=${formatBytes(result.openPeakHeapDeltaBytes)}`,
    );

    for (const [name, query] of Object.entries(result.queries)) {
      console.log(
        `  ${name}: p50=${query.p50Ms.toFixed(2)}ms p95=${query.p95Ms.toFixed(2)}ms results=${query.resultCount}`,
      );
    }

    console.log(`  acceptance=${result.acceptance.passed ? "PASS" : "FAIL"}`);
  }

  if (report.benchmark.scaling.measured) {
    console.log(
      `\n100k -> 1m p95 growth: ${Object.entries(report.benchmark.scaling.p95Growth)
        .map(([name, growth]) => `${name}=${growth.toFixed(2)}x`)
        .join(" ")} acceptance=${report.benchmark.scaling.passed ? "PASS" : "FAIL"}`,
    );
  }
}

function formatBytes(value) {
  return `${(value / MEBIBYTE).toFixed(2)} MiB`;
}

function readSizes(name, fallback) {
  const raw = readArgument(name);
  if (!raw) return fallback;
  const sizes = raw
    .split(",")
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return sizes.length ? sizes : fallback;
}

function readPositiveInteger(name, fallback) {
  const value = Number(readArgument(name));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInteger(name, fallback) {
  const value = Number(readArgument(name));
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function waitForWorkerOnline(worker) {
  return new Promise((resolve, reject) => {
    worker.once("online", resolve);
    worker.once("error", reject);
  });
}

function waitForMessage(worker, type) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
  });
}

function waitForParentMessage(type) {
  return new Promise((resolve) => {
    const onMessage = (message) => {
      if (message.type !== type) return;
      parentPort.off("message", onMessage);
      resolve(message);
    };
    parentPort.on("message", onMessage);
  });
}

function collectGarbage() {
  if (typeof global.gc !== "function") {
    throw new Error("Run this benchmark with Node.js --expose-gc");
  }
  global.gc();
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
