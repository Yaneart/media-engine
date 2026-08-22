import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { filmixStreamingProvider } from "./index.js";

const BASE_URL = "https://filmix-api.test/api/v2";

test("filmixStreamingProvider resolves one exact series episode into direct guest MP4", async () => {
  const requestedUrls: URL[] = [];
  const provider = filmixStreamingProvider({
    baseUrl: BASE_URL,
    siteBaseUrl: "https://filmix.test",
    deviceId: "0123456789abcdef",
    now: () => Date.parse("2026-08-22T10:00:00.000Z"),
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);
      return url.pathname.endsWith("/search")
        ? Response.json([createSummary()])
        : Response.json(createPost());
    },
  });

  const result = await provider.getAvailability(
    { type: "series", title: "Укрытие", year: 2023, seasonNumber: 3, episodeNumber: 1 },
    {},
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0]!.pathname, "/api/v2/search");
  assert.equal(requestedUrls[0]!.searchParams.get("story"), "Укрытие");
  assert.equal(requestedUrls[0]!.searchParams.get("user_dev_id"), "0123456789abcdef");
  assert.equal(requestedUrls[0]!.searchParams.get("user_dev_apk"), "2.2.13");
  assert.equal(requestedUrls[0]!.searchParams.get("app_lang"), "ru_RU");
  assert.equal(requestedUrls[0]!.searchParams.has("user_dev_token"), false);
  assert.equal(requestedUrls[1]!.pathname, "/api/v2/post/165638");
  assert.equal(result?.options[0]?.player.kind, "mp4");
  assert.equal(result?.options[0]?.quality?.height, 480);
  assert.equal(result?.options[0]?.access.url, "https://cdn.test/s03e01_480.mp4");
  assert.deepEqual(result?.sourceProviders, [
    {
      provider: "filmix-streaming",
      url: "https://filmix.test/seria/165638-silo-2023.html",
    },
  ]);
});

test("filmixStreamingProvider sends an owned token only to HTTPS and exposes 720p", async () => {
  const requestedUrls: URL[] = [];
  const provider = filmixStreamingProvider({
    baseUrl: BASE_URL,
    token: "owned-token",
    deviceId: "0123456789abcdef",
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url);
      return url.pathname.endsWith("/search")
        ? Response.json([createSummary()])
        : Response.json(createPost());
    },
  });

  const result = await provider.getAvailability(
    { type: "series", title: "Silo", year: 2023, seasonNumber: 3, episodeNumber: 1 },
    {},
  );

  assert.equal(requestedUrls.length, 2);
  assert.equal(
    requestedUrls.every((url) => url.protocol === "https:"),
    true,
  );
  assert.equal(
    requestedUrls.every((url) => url.searchParams.get("user_dev_token") === "owned-token"),
    true,
  );
  assert.deepEqual(
    result?.options.map((option) => option.quality?.height),
    [720, 480],
  );
  assert.equal(JSON.stringify(result).includes("owned-token"), false);
});

test("filmixStreamingProvider avoids unsupported or underidentified queries", async () => {
  let calls = 0;
  const provider = filmixStreamingProvider({
    deviceId: "0123456789abcdef",
    fetch: async () => {
      calls += 1;
      return Response.json([]);
    },
  });

  for (const query of [
    { type: "movie" as const, title: "Movie" },
    { type: "movie" as const, title: "Movie", year: 2024, seasonNumber: 1 },
    { type: "series" as const, title: "Silo", year: 2023 },
    { type: "series" as const, title: "Silo", year: 2023, seasonNumber: 3 },
    {
      type: "series" as const,
      title: "Silo",
      year: 2023,
      seasonNumber: 3,
      episodeNumber: 1,
      providers: ["other-provider"],
    },
  ]) {
    assert.equal(await provider.getAvailability(query, {}), null);
  }
  assert.equal(calls, 0);
});

test("filmixStreamingProvider revalidates the selected post", async () => {
  let calls = 0;
  const provider = filmixStreamingProvider({
    baseUrl: BASE_URL,
    deviceId: "0123456789abcdef",
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? Response.json([createSummary()])
        : Response.json({ ...createPost(), id: 999 });
    },
  });

  assert.equal(
    await provider.getAvailability(
      { type: "series", title: "Silo", year: 2023, seasonNumber: 3, episodeNumber: 1 },
      {},
    ),
    null,
  );
  assert.equal(calls, 2);
});

test("filmixStreamingProvider preserves caller cancellation and typed schema failures", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const cancellingProvider = filmixStreamingProvider({
    deviceId: "0123456789abcdef",
    fetch: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  });
  const pending = cancellingProvider.getAvailability(
    { type: "movie", title: "Movie", year: 2024 },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);
  await assert.rejects(pending, (error) => error === cancellation);

  const invalidProvider = filmixStreamingProvider({
    deviceId: "0123456789abcdef",
    fetch: async () => Response.json({ data: [] }),
  });
  await assert.rejects(
    invalidProvider.getAvailability({ type: "movie", title: "Movie", year: 2024 }, {}),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      return true;
    },
  );
});

function createSummary() {
  return {
    id: 165638,
    title: "Бункер",
    original_title: "Silo",
    year: 2023,
    section: 7,
    alt_name: "silo-2023",
  };
}

function createPost() {
  return {
    ...createSummary(),
    player_links: {
      playlist: {
        "3": {
          HDrezka: [
            {
              link: "https://cdn.test/s03e01_%s.mp4",
              qualities: [720, 480],
            },
          ],
        },
      },
    },
  };
}
