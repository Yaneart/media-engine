import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { readBoundedResponseBytes, readBoundedResponseText } from "./response-body.js";

test("bounded response reader rejects declared oversized bodies before reading", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    () =>
      readBoundedResponseBytes(
        "test-provider",
        new Response(body, {
          headers: { "content-length": "11" },
        }),
        10,
      ),
    {
      name: "ProviderError",
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      retryable: false,
    },
  );

  assert.ok(pulls <= 1);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("bounded response reader cancels a chunked body after at most one overflow chunk", async () => {
  const chunks = [
    new Uint8Array([1, 2, 3, 4, 5, 6]),
    new Uint8Array([7, 8, 9, 10, 11, 12]),
    new Uint8Array([13, 14, 15, 16, 17, 18]),
  ];
  let enqueuedBytes = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks.shift();
        if (!chunk) {
          controller.close();
          return;
        }
        enqueuedBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  await assert.rejects(
    () => readBoundedResponseBytes("test-provider", new Response(body), 10),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_TOO_LARGE",
  );

  assert.ok(enqueuedBytes <= 16, `reader enqueued ${enqueuedBytes} bytes`);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("bounded response reader supports missing or untrusted Content-Length", async () => {
  assert.deepEqual(
    await readBoundedResponseBytes("test-provider", new Response(null), 8),
    new Uint8Array(),
  );
  assert.equal(
    await readBoundedResponseText(
      "test-provider",
      new Response("working", { headers: { "content-length": "not-a-number" } }),
      8,
    ),
    "working",
  );
});

test("bounded response reader can preserve the accepted prefix for marker scans", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("video not found"));
      controller.enqueue(encoder.encode(" ignored overflow"));
    },
    cancel() {
      cancelled = true;
    },
  });

  const result = await readBoundedResponseText("test-provider", new Response(body), 15, {
    overflow: "truncate",
  });

  assert.equal(result, "video not found");
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("bounded response reader cancels and unlocks a pending body on abort", async () => {
  const controller = new AbortController();
  const abortError = new ProviderError({
    provider: "test-provider",
    code: "PROVIDER_TIMEOUT",
    message: "Provider timed out.",
    retryable: true,
  });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });

  const request = readBoundedResponseBytes("test-provider", new Response(body), 8, {
    signal: controller.signal,
  });
  controller.abort(abortError);

  await assert.rejects(request, (error: unknown) => error === abortError);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
