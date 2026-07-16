import assert from "node:assert/strict";
import { test } from "node:test";

import { rethrowIfProviderAborted } from "./abort.js";

test("rethrowIfProviderAborted ignores ordinary optional failures", () => {
  assert.doesNotThrow(() => rethrowIfProviderAborted({}, new Error("Optional upstream failed.")));
});

test("rethrowIfProviderAborted preserves the caller abort reason", () => {
  const controller = new AbortController();
  const reason = new Error("Request canceled.");
  controller.abort(reason);

  assert.throws(
    () => rethrowIfProviderAborted({ signal: controller.signal }, new Error("Fetch failed.")),
    reason,
  );
});
