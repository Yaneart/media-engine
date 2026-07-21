import assert from "node:assert/strict";
import test from "node:test";

import {
  SMOKE_CLASSIFICATION,
  classifySmokeError,
  classifySmokeOutcome,
  createSmokeReport,
  readSmokePolicy,
} from "./smoke-policy.mjs";

test("default policy always fails contract regressions but allows warnings", () => {
  const policy = readSmokePolicy([]);
  const warned = createSmokeReport({
    smoke: "test",
    policy,
    results: [{ status: "WARN" }],
  });
  const failed = createSmokeReport({
    smoke: "test",
    policy,
    results: [{ status: "FAIL" }],
  });

  assert.equal(policy.maxWarnings, Number.POSITIVE_INFINITY);
  assert.equal(warned.summary.exitCode, 0);
  assert.equal(failed.summary.exitCode, 1);
});

test("strict and fail-on-warn both enforce a zero warning budget", () => {
  for (const argument of ["--strict", "--fail-on-warn"]) {
    const policy = readSmokePolicy([argument]);
    const report = createSmokeReport({
      smoke: "test",
      policy,
      results: [{ status: "WARN", classification: SMOKE_CLASSIFICATION.budgetExceeded }],
    });

    assert.equal(policy.maxWarnings, 0);
    assert.equal(report.summary.warningBudgetExceeded, true);
    assert.equal(report.summary.exitCode, 1);
  }
});

test("max-warnings exposes a bounded, machine-readable exit policy", () => {
  const policy = readSmokePolicy(["--max-warnings", "2", "--json"]);
  const report = createSmokeReport({
    smoke: "test",
    policy,
    metadata: { matrix: "full" },
    results: [
      { status: "PASS" },
      { status: "WARN" },
      { status: "WARN", classification: SMOKE_CLASSIFICATION.budgetExceeded },
    ],
  });

  assert.equal(policy.json, true);
  assert.equal(report.matrix, "full");
  assert.deepEqual(report.policy, { contractRegressionsFail: true, maxWarnings: 2 });
  assert.deepEqual(report.summary, {
    total: 3,
    pass: 1,
    warn: 2,
    fail: 0,
    classifications: {
      HEALTHY: 1,
      UPSTREAM_DEGRADED: 1,
      BUDGET_EXCEEDED: 1,
      CONTRACT_REGRESSION: 0,
    },
    warningBudgetExceeded: false,
    exitCode: 0,
  });
});

test("warning count above the configured budget exits non-zero", () => {
  const report = createSmokeReport({
    smoke: "test",
    policy: readSmokePolicy(["--max-warnings", "1"]),
    results: [{ status: "WARN" }, { status: "WARN" }],
  });

  assert.equal(report.summary.warningBudgetExceeded, true);
  assert.equal(report.summary.exitCode, 1);
});

test("invalid and duplicate max-warnings values fail before network work", () => {
  for (const argv of [
    ["--max-warnings"],
    ["--max-warnings", "-1"],
    ["--max-warnings", "1.5"],
    ["--max-warnings", "1", "--max-warnings", "2"],
  ]) {
    assert.throws(() => readSmokePolicy(argv), /--max-warnings/);
  }
});

test("provider-wide engine errors are upstream degradation", () => {
  assert.deepEqual(classifySmokeError({ name: "MediaEngineError", code: "PROVIDER_ERROR" }), {
    status: "WARN",
    classification: SMOKE_CLASSIFICATION.upstreamDegraded,
  });
  assert.deepEqual(classifySmokeError(new Error("broken assertion")), {
    status: "FAIL",
    classification: SMOKE_CLASSIFICATION.contractRegression,
  });
});

test("outcome classification keeps contract, upstream, and budget failures separate", () => {
  assert.deepEqual(classifySmokeOutcome(), {
    status: "PASS",
    classification: SMOKE_CLASSIFICATION.healthy,
  });
  assert.deepEqual(classifySmokeOutcome({ budgetExceeded: true }), {
    status: "WARN",
    classification: SMOKE_CLASSIFICATION.budgetExceeded,
  });
  assert.deepEqual(classifySmokeOutcome({ upstreamDegraded: true, budgetExceeded: true }), {
    status: "WARN",
    classification: SMOKE_CLASSIFICATION.upstreamDegraded,
  });
  assert.deepEqual(classifySmokeOutcome({ contractRegression: true, upstreamDegraded: true }), {
    status: "FAIL",
    classification: SMOKE_CLASSIFICATION.contractRegression,
  });
});

test("invalid status/classification combinations are rejected", () => {
  assert.throws(
    () =>
      createSmokeReport({
        smoke: "test",
        policy: readSmokePolicy([]),
        results: [{ status: "FAIL", classification: SMOKE_CLASSIFICATION.upstreamDegraded }],
      }),
    /FAIL smoke results/,
  );
});
