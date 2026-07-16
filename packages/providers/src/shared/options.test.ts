import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBoundedIntegerOption } from "./options.js";

test("resolveBoundedIntegerOption accepts defaults and inclusive bounds", () => {
  assert.equal(resolveBoundedIntegerOption(undefined, 10, "limit", 1, 100), 10);
  assert.equal(resolveBoundedIntegerOption(1, 10, "limit", 1, 100), 1);
  assert.equal(resolveBoundedIntegerOption(100, 10, "limit", 1, 100), 100);
});

test("resolveBoundedIntegerOption rejects unsafe numeric configuration", () => {
  for (const value of [0, 101, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => resolveBoundedIntegerOption(value, 10, "limit", 1, 100),
      /limit must be an integer between 1 and 100/,
    );
  }
});
