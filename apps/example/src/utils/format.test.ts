import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCountedLabel } from "./format.ts";

test("single player labels omit a redundant count", () => {
  assert.equal(formatCountedLabel("Alloha", 1), "Alloha");
  assert.equal(formatCountedLabel("Collaps", 2), "Collaps (2)");
});
