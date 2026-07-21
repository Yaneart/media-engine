#!/usr/bin/env node

import os from "node:os";
import { performance } from "node:perf_hooks";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";

const DEFAULT_SIZES = [100_000, 1_000_000];
const DEFAULT_ITERATIONS = 5;
const DEFAULT_WARMUP_ITERATIONS = 1;
const HEAP_SAMPLE_INTERVAL_MS = 5;

if (isMainThread) {
  await runCoordinator();
} else {
  await runWorker();
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

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    implementation: "imdbDatasetProvider in-memory TSV adapter",
    heapSamplingIntervalMs: HEAP_SAMPLE_INTERVAL_MS,
    environment: {
      node: process.version,
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
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
}

async function benchmarkSize(size, iterations, warmupIterations) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { size, iterations, warmupIterations },
  });

  try {
    const readyPromise = waitForMessage(worker, "ready");
    await waitForWorkerOnline(worker);
    const ready = await readyPromise;
    const heapSamples = [ready.baselineHeapBytes];
    let sampling = true;
    const sampler = sampleWorkerHeap(worker, heapSamples, () => sampling);
    const startupPromise = waitForMessage(worker, "startup-complete");

    worker.postMessage({ type: "start" });
    const startup = await startupPromise;
    sampling = false;
    await sampler;

    const finalStartupHeap = await worker.getHeapStatistics();
    heapSamples.push(finalStartupHeap.used_heap_size);
    const queriesPromise = waitForMessage(worker, "queries-complete");
    worker.postMessage({ type: "run-queries" });
    const queries = await queriesPromise;

    return {
      rows: size,
      ratingRows: ready.ratingRows,
      fixtureBytes: ready.fixtureBytes,
      startupMs: startup.startupMs,
      retainedHeapDeltaBytes: Math.max(0, startup.retainedHeapBytes - ready.baselineHeapBytes),
      sampledPeakHeapDeltaBytes: Math.max(0, Math.max(...heapSamples) - ready.baselineHeapBytes),
      queries: queries.results,
    };
  } finally {
    await worker.terminate();
  }
}

async function runWorker() {
  const { imdbDatasetProvider } = await import("../packages/providers/dist/imdb-dataset/index.js");
  const { size, iterations, warmupIterations } = workerData;
  const fixture = createFixture(size);

  collectGarbage();
  parentPort.postMessage({
    type: "ready",
    baselineHeapBytes: process.memoryUsage().heapUsed,
    fixtureBytes:
      Buffer.byteLength(fixture.titleBasicsTsv) + Buffer.byteLength(fixture.titleRatingsTsv),
    ratingRows: fixture.ratingRows,
  });

  await waitForParentMessage("start");
  const startupStartedAt = performance.now();
  const provider = imdbDatasetProvider({
    titleBasicsTsv: fixture.titleBasicsTsv,
    titleRatingsTsv: fixture.titleRatingsTsv,
  });
  const startupMs = performance.now() - startupStartedAt;

  collectGarbage();
  parentPort.postMessage({
    type: "startup-complete",
    startupMs,
    retainedHeapBytes: process.memoryUsage().heapUsed,
  });

  await waitForParentMessage("run-queries");
  const queries = createQueries(size);
  const results = {};

  for (const [name, query] of Object.entries(queries)) {
    for (let index = 0; index < warmupIterations; index += 1) {
      await provider.search(query, {});
    }

    const samples = [];
    let resultCount = 0;

    for (let index = 0; index < iterations; index += 1) {
      const startedAt = performance.now();
      const queryResults = await provider.search(query, {});
      samples.push(performance.now() - startedAt);
      resultCount = queryResults.length;
    }

    results[name] = {
      ...summarize(samples),
      resultCount,
      supported: name !== "fuzzyMiss",
    };
  }

  parentPort.postMessage({ type: "queries-complete", results });
}

function createFixture(size) {
  const basics = [
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
  ];
  const ratings = ["tconst\taverageRating\tnumVotes"];
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

    basics.push(
      `${imdbId}\t${type}\t${title}\t${title}\t0\t${year}\t\\N\t${80 + (index % 80)}\tDrama`,
    );

    if (index % 3 === 0 || index === exactIndex) {
      ratings.push(`${imdbId}\t${(5 + (index % 45) / 10).toFixed(1)}\t${100 + index}`);
      ratingRows += 1;
    }
  }

  return {
    titleBasicsTsv: basics.join("\n"),
    titleRatingsTsv: ratings.join("\n"),
    ratingRows,
  };
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
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

function printReport(report) {
  console.log(
    `IMDb dataset benchmark (${report.environment.node}, ${report.environment.architecture}, ${report.environment.cpu})`,
  );

  for (const result of report.benchmark.sizes) {
    console.log(`\n${result.rows.toLocaleString("en-US")} title rows`);
    console.log(
      `  fixture=${formatBytes(result.fixtureBytes)} startup=${result.startupMs.toFixed(2)}ms`,
    );
    console.log(
      `  retainedHeap=${formatBytes(result.retainedHeapDeltaBytes)} sampledPeakHeap=${formatBytes(result.sampledPeakHeapDeltaBytes)}`,
    );

    for (const [name, query] of Object.entries(result.queries)) {
      const support = query.supported ? "" : " (unsupported miss baseline)";
      console.log(
        `  ${name}${support}: p50=${query.p50Ms.toFixed(2)}ms p95=${query.p95Ms.toFixed(2)}ms results=${query.resultCount}`,
      );
    }
  }
}

function formatBytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function readSizes(name, fallback) {
  const raw = readArgument(name);

  if (!raw) {
    return fallback;
  }

  const sizes = raw
    .split(",")
    .map((value) => Number(value))
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
      if (message.type !== type) {
        return;
      }

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
      if (message.type !== type) {
        return;
      }

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
