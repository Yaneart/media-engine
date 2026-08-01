import assert from "node:assert/strict";
import { test } from "node:test";

import { rethrowIfProviderAborted, waitForAbortableDelay } from "./abort.js";

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

test("waitForAbortableDelay handles immediate, completed, and aborted waits", async () => {
  await waitForAbortableDelay(0, undefined);
  await waitForAbortableDelay(1, undefined);

  const reason = new Error("Delay canceled.");
  const preAborted = new AbortController();
  preAborted.abort(reason);
  await assert.rejects(waitForAbortableDelay(0, preAborted.signal), reason);

  const active = new AbortController();
  const pending = waitForAbortableDelay(1_000, active.signal);
  active.abort(reason);
  await assert.rejects(pending, reason);
});
