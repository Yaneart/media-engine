import assert from "node:assert/strict";
import { test } from "node:test";

import { ddbbStreamingProvider } from "./index.js";

const BASE_URL = "https://ddbb.test";

test("ddbbStreamingProvider returns independently validated diverse embeds", async () => {
  const requestedUrls: string[] = [];
  const provider = ddbbStreamingProvider({
    baseUrl: BASE_URL,
    playerValidationLimit: 4,
    fetch: async (input) => {
      const url = new URL(input.toString());
      requestedUrls.push(url.href);

      if (url.hostname === "ddbb.test") {
        return Response.json({
          data: [
            {
              type: "Alloha",
              iframeUrl: "https://missing.test/main",
              translations: [
                {
                  id: 87,
                  name: "Профессиональный многоголосый",
                  quality: "FHD (1080p)",
                  iframeUrl: "https://working.test/87",
                },
              ],
            },
            {
              type: "Collaps",
              iframeUrl: "https://working.test/collaps",
              translations: [],
            },
            {
              type: "Turbo",
              iframeUrl: "https://transient.test/turbo",
              translations: [],
            },
          ],
        });
      }
      if (url.hostname === "missing.test") return new Response("Not found", { status: 404 });
      if (url.hostname === "working.test") return new Response("<html>player</html>");
      if (url.hostname === "transient.test") return new Response("Unavailable", { status: 503 });
      return new Response("Not found", { status: 404 });
    },
  });

  const result = await provider.getAvailability(
    {
      type: "movie",
      title: "Interstellar",
      year: 2014,
      ids: { kinopoisk: "258687", imdb: "tt0816692" },
    },
    {},
  );

  assert.equal(requestedUrls[0], "https://ddbb.test/api/players?kinopoisk=258687&n=0");
  assert.deepEqual(
    result?.options.map((option) => [option.player.label, option.availability]),
    [
      ["Collaps", "available"],
      ["Turbo", "unknown"],
      ["Alloha", "available"],
    ],
  );
  assert.deepEqual(result?.item?.ids, { kinopoisk: "258687", imdb: "tt0816692" });
  assert.equal(result?.episodes, undefined);
  assert.deepEqual(result?.sourceProviders, [
    {
      provider: "ddbb-streaming",
      url: "https://ddbb.test/api/players?kinopoisk=258687&n=0",
      ids: { kinopoisk: "258687", imdb: "tt0816692" },
    },
  ]);
});

test("ddbbStreamingProvider returns null for missing, unsupported, or exact-episode queries", async () => {
  let calls = 0;
  const provider = ddbbStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      calls += 1;
      return Response.json({
        data: [
          { type: "Alloha", iframeUrl: null, translations: [] },
          { type: "Collaps", iframeUrl: null, translations: [] },
        ],
      });
    },
  });

  assert.equal(await provider.getAvailability({ type: "movie", title: "No IDs" }, {}), null);
  assert.equal(
    await provider.getAvailability(
      { type: "movie", ids: { kinopoisk: "258687" }, providers: ["other"] },
      {},
    ),
    null,
  );
  assert.equal(
    await provider.getAvailability(
      { type: "series", ids: { kinopoisk: "464963" }, seasonNumber: 1, episodeNumber: 1 },
      {},
    ),
    null,
  );
  assert.equal(
    await provider.getAvailability({ type: "movie", ids: { kinopoisk: "999999999" } }, {}),
    null,
  );
  assert.equal(calls, 1);
});

test("ddbbStreamingProvider preserves caller cancellation during player validation", async () => {
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const provider = ddbbStreamingProvider({
    baseUrl: BASE_URL,
    playerValidationTimeoutMs: 10_000,
    fetch: async (input, init) => {
      const url = new URL(input.toString());
      if (url.hostname === "ddbb.test") {
        return Response.json({
          data: [
            {
              type: "Slow",
              iframeUrl: "https://slow.test/embed",
              translations: [],
            },
          ],
        });
      }

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  });

  const result = provider.getAvailability(
    { type: "movie", ids: { imdb: "tt0816692" } },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation);

  await assert.rejects(result, (error) => error === cancellation);
});

test("ddbbStreamingProvider bounds concurrent player validation", async () => {
  let active = 0;
  let maximumActive = 0;
  const provider = ddbbStreamingProvider({
    baseUrl: BASE_URL,
    playerValidationLimit: 4,
    playerValidationConcurrency: 2,
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "ddbb.test") {
        return Response.json({
          data: Array.from({ length: 4 }, (_, index) => ({
            type: `Player ${index + 1}`,
            iframeUrl: `https://player-${index + 1}.test/embed`,
            translations: [],
          })),
        });
      }

      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return new Response("<html>player</html>");
    },
  });

  const result = await provider.getAvailability(
    { type: "anime", ids: { kinopoisk: "452838" } },
    {},
  );

  assert.equal(result?.options.length, 4);
  assert.equal(maximumActive, 2);
});
