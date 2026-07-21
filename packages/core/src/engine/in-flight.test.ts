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

test("aborting one subscriber keeps shared work alive for the other", async () => {
  const coalescer = new InFlightRequestCoalescer();
  const firstController = new AbortController();
  let sharedSignal: AbortSignal | undefined;
  let resolveLoad: ((value: { value: string }) => void) | undefined;
  const load = async (signal: AbortSignal) => {
    sharedSignal = signal;
    return new Promise<{ value: string }>((resolve) => {
      resolveLoad = resolve;
    });
  };
  const first = coalescer.run("search:one", load, { signal: firstController.signal });
  const second = coalescer.run("search:one", load);

  await Promise.resolve();
  const reason = new Error("first caller left");
  firstController.abort(reason);
  await assert.rejects(first, (error) => error === reason);
  assert.equal(sharedSignal?.aborted, false);

  resolveLoad?.({ value: "done" });
  assert.deepEqual(await second, { value: "done" });
});

test("aborting every subscriber cancels shared work once", async () => {
  const coalescer = new InFlightRequestCoalescer();
  const firstController = new AbortController();
  const secondController = new AbortController();
  let sharedSignal: AbortSignal | undefined;
  let sharedAborts = 0;
  const load = async (signal: AbortSignal): Promise<never> => {
    sharedSignal = signal;
    return new Promise((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          sharedAborts += 1;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };
  const first = coalescer.run("search:one", load, { signal: firstController.signal });
  const second = coalescer.run("search:one", load, { signal: secondController.signal });

  await Promise.resolve();
  firstController.abort(new Error("first left"));
  await assert.rejects(first, /first left/);
  assert.equal(sharedSignal?.aborted, false);

  secondController.abort(new Error("second left"));
  await assert.rejects(second, /second left/);
  await Promise.resolve();
  assert.equal(sharedSignal?.aborted, true);
  assert.equal(sharedAborts, 1);
  assert.equal(sharedSignal?.reason?.name, "AbortError");

  const retry = await coalescer.run("search:one", async () => ({ value: "fresh" }));
  assert.deepEqual(retry, { value: "fresh" });
});

test("a pre-aborted caller never starts shared work", async () => {
  const coalescer = new InFlightRequestCoalescer();
  const controller = new AbortController();
  const reason = new Error("already gone");
  let calls = 0;
  controller.abort(reason);

  await assert.rejects(
    coalescer.run(
      "details:one",
      async () => {
        calls += 1;
        return { value: "unexpected" };
      },
      { signal: controller.signal },
    ),
    (error) => error === reason,
  );
  assert.equal(calls, 0);
});

test("joins existing work without starting a cache miss", async () => {
  const coalescer = new InFlightRequestCoalescer();

  assert.equal(coalescer.joinExisting("details:missing"), undefined);

  let resolveLoad: ((value: { value: string }) => void) | undefined;
  const original = coalescer.run("details:one", async () => {
    return new Promise<{ value: string }>((resolve) => {
      resolveLoad = resolve;
    });
  });
  await Promise.resolve();

  const joined = coalescer.joinExisting<{ value: string }>("details:one");
  assert.ok(joined);
  resolveLoad?.({ value: "shared" });

  assert.deepEqual(await original, { value: "shared" });
  assert.deepEqual(await joined, { value: "shared" });
});
