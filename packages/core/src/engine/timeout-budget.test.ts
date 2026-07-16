import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderTimeoutBudget } from "./timeout-budget.js";

test("ProviderTimeoutBudget shares one deadline across provider calls", () => {
  let now = 1_000;
  const budget = new ProviderTimeoutBudget(
    () => 500,
    () => now,
  );

  assert.equal(budget.getRemainingMs("catalog"), 500);
  now += 125;
  assert.equal(budget.getRemainingMs("catalog"), 375);
  now += 500;
  assert.equal(budget.getRemainingMs("catalog"), 0);
});

test("ProviderTimeoutBudget isolates providers and applies per-call caps", () => {
  let now = 0;
  const budget = new ProviderTimeoutBudget(
    (provider) => (provider === "slow" ? 5_000 : 1_000),
    () => now,
  );

  assert.equal(budget.getRemainingMs("slow", 1_500), 1_500);
  assert.equal(budget.getRemainingMs("fast"), 1_000);
  now = 500;
  assert.equal(budget.getRemainingMs("slow"), 1_000);
  assert.equal(budget.getRemainingMs("fast"), 500);
});

test("ProviderTimeoutBudget preserves an unbounded provider until a call is capped", () => {
  let now = 0;
  const budget = new ProviderTimeoutBudget(
    () => undefined,
    () => now,
  );

  assert.equal(budget.getRemainingMs("catalog"), undefined);
  assert.equal(budget.getRemainingMs("catalog", 200), 200);
  now = 50;
  assert.equal(budget.getRemainingMs("catalog"), 150);
});
