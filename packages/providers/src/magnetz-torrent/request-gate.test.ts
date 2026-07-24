import assert from "node:assert/strict";
import { test } from "node:test";

import { MagnetzRequestGate } from "./request-gate.js";

test("MagnetzRequestGate serializes and spaces concurrent request starts", async () => {
  const gate = new MagnetzRequestGate({ intervalMs: 15 });
  const starts: number[] = [];

  await Promise.all(
    Array.from({ length: 3 }, async () => {
      await gate.wait();
      starts.push(Date.now());
    }),
  );

  assert.equal(starts.length, 3);
  assert.ok(starts[1]! - starts[0]! >= 10);
  assert.ok(starts[2]! - starts[1]! >= 10);
});

test("MagnetzRequestGate removes an aborted waiter without blocking later work", async () => {
  const gate = new MagnetzRequestGate({ intervalMs: 25 });
  await gate.wait();

  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const waiting = gate.wait(controller.signal);
  controller.abort(cancellation);

  await assert.rejects(
    () => waiting,
    (error) => error === cancellation,
  );
  await assert.doesNotReject(() => gate.wait());
});
