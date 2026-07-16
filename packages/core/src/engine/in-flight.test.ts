import assert from "node:assert/strict";
import { test } from "node:test";

import { InFlightRequestCoalescer } from "./in-flight.js";

test("coalesces identical loads and isolates caller results", async () => {
  const coalescer = new InFlightRequestCoalescer();
  let calls = 0;
  let resolveLoad: ((value: { nested: { value: string } }) => void) | undefined;
  const load = async () => {
    calls += 1;
    return new Promise<{ nested: { value: string } }>((resolve) => {
      resolveLoad = resolve;
    });
  };

  const firstPromise = coalescer.run("search:one", load);
  const secondPromise = coalescer.run("search:one", load);

  await Promise.resolve();
  resolveLoad?.({ nested: { value: "original" } });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(calls, 1);
  assert.notEqual(first, second);
  first.nested.value = "changed";
  assert.equal(second.nested.value, "original");
});

test("clears failed loads so a later request can retry", async () => {
  const coalescer = new InFlightRequestCoalescer();
  let calls = 0;
  const load = async () => {
    calls += 1;
    throw new Error("upstream failed");
  };

  const first = coalescer.run("details:one", load);
  const second = coalescer.run("details:one", load);

  await assert.rejects(first, /upstream failed/);
  await assert.rejects(second, /upstream failed/);
  await assert.rejects(coalescer.run("details:one", load), /upstream failed/);
  assert.equal(calls, 2);
});
