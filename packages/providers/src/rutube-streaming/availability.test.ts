import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { rutubeStreamingProvider } from "./index.js";

test("rutubeStreamingProvider maps one exact public full movie to the official embed", async () => {
  const requests: URL[] = [];
  const provider = rutubeStreamingProvider({
    baseUrl: "https://rutube.test",
    now: () => Date.parse("2026-08-22T12:00:00.000Z"),
    fetch: async (input) => {
      requests.push(new URL(input.toString()));
      return Response.json({ results: [createCandidate()] });
    },
  });

  const result = await provider.getAvailability({ type: "movie", title: "Начало", year: 2010 }, {});

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.searchParams.get("query"), "Начало 2010");
  assert.equal(result?.options[0]?.player.kind, "embed");
  assert.equal(result?.options[0]?.player.label, "Rutube");
  assert.equal(result?.options[0]?.access.url, `https://rutube.test/play/embed/${"a".repeat(32)}`);
  assert.equal(result?.options[0]?.sourceUrl, `https://rutube.test/video/${"a".repeat(32)}/`);
  assert.equal(result?.checkedAt, "2026-08-22T12:00:00.000Z");
});

test("rutubeStreamingProvider rejects noisy, restricted, short, and unsupported results", async () => {
  let calls = 0;
  const provider = rutubeStreamingProvider({
    baseUrl: "https://rutube.test",
    fetch: async () => {
      calls += 1;
      return Response.json({
        results: [
          createCandidate({ title: "Начало 2010 обзор фильма" }),
          createCandidate({ is_paid: true }),
          createCandidate({ duration: 120 }),
        ],
      });
    },
  });

  assert.equal(
    await provider.getAvailability({ type: "movie", title: "Начало", year: 2010 }, {}),
    null,
  );

  for (const query of [
    { type: "movie" as const, title: "Начало" },
    { type: "series" as const, title: "Silo", year: 2023 },
    { type: "movie" as const, title: "Начало", year: 2010, seasonNumber: 1 },
    {
      type: "movie" as const,
      title: "Начало",
      year: 2010,
      providers: ["other-provider"],
    },
  ]) {
    assert.equal(await provider.getAvailability(query, {}), null);
  }
  assert.equal(calls, 1);
});

test("rutubeStreamingProvider preserves cancellation and typed schema failures", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const cancellingProvider = rutubeStreamingProvider({
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  });
  const pending = cancellingProvider.getAvailability(
    { type: "movie", title: "Начало", year: 2010 },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);
  await assert.rejects(pending, (error) => error === cancellation);

  const invalidProvider = rutubeStreamingProvider({
    fetch: async () => Response.json({ data: [] }),
  });
  await assert.rejects(
    invalidProvider.getAvailability({ type: "movie", title: "Начало", year: 2010 }, {}),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      return true;
    },
  );
});

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(32),
    title: "Начало (фильм, 2010)",
    duration: 8_888,
    category: { id: 4 },
    is_hidden: false,
    is_deleted: false,
    is_adult: false,
    is_locked: false,
    is_audio: false,
    is_paid: false,
    is_livestream: false,
    ...overrides,
  };
}
