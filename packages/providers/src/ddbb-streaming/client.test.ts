import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@media-engine/core";
import { createDdbbLookupUrl, loadDdbbPlayers, parseDdbbResponse } from "./client.js";
import { createDdbbConfig } from "./config.js";

test("parseDdbbResponse accepts bounded nullable players and translations", () => {
  const players = parseDdbbResponse("ddbb-test", {
    data: [
      {
        type: " Alloha ",
        iframeUrl: "https://alloha.test/main",
        translations: [
          {
            id: 87,
            name: "Профессиональный многоголосый",
            quality: "FHD (1080p)",
            iframeUrl: "https://alloha.test/87",
          },
          { id: null, name: null, quality: null, iframeUrl: null },
          "invalid",
        ],
      },
      { type: "Collaps", iframeUrl: null, translations: [] },
      { type: 42, iframeUrl: null, translations: [] },
    ],
  });

  assert.deepEqual(players, [
    {
      type: "Alloha",
      iframeUrl: "https://alloha.test/main",
      translations: [
        {
          id: "87",
          name: "Профессиональный многоголосый",
          quality: "FHD (1080p)",
          iframeUrl: "https://alloha.test/87",
        },
        {},
      ],
    },
    { type: "Collaps", translations: [] },
  ]);
});

test("parseDdbbResponse rejects schema drift but permits an empty data array", () => {
  assert.deepEqual(parseDdbbResponse("ddbb-test", { data: [] }), []);

  for (const value of [{}, { data: null }, { data: [null, "broken"] }]) {
    assert.throws(
      () => parseDdbbResponse("ddbb-test", value),
      (error) =>
        error instanceof ProviderError &&
        error.code === "PROVIDER_INVALID_RESPONSE" &&
        error.retryable === false,
    );
  }
});

test("createDdbbLookupUrl emits only the selected external ID and stable mode", () => {
  assert.equal(
    createDdbbLookupUrl("https://ddbb.test", { source: "kinopoisk", id: "258687" }).href,
    "https://ddbb.test/api/players?kinopoisk=258687&n=0",
  );
  assert.equal(
    createDdbbLookupUrl("https://ddbb.test", { source: "imdb", id: "tt0816692" }).href,
    "https://ddbb.test/api/players?imdb=tt0816692&n=0",
  );
});

test("DDBB defaults fail over to a.ddbb.live on network, HTTP, and schema failures", async () => {
  for (const failure of ["network", "http", "json", "schema"]) {
    const urls: string[] = [];
    const config = createDdbbConfig({
      fetch: async (input) => {
        const url = new URL(input);
        urls.push(url.href);
        if (url.hostname === "p2.ddbb.lol") {
          if (failure === "network") throw new TypeError("fetch failed");
          if (failure === "http") return new Response(null, { status: 503 });
          return failure === "json" ? new Response("<html>offline</html>") : Response.json({});
        }
        return Response.json({ data: [{ type: "Collaps", translations: [] }] });
      },
    });
    const result = await loadDdbbPlayers(config, { source: "kinopoisk", id: "2000102" }, {});
    assert.deepEqual(urls, [
      "https://p2.ddbb.lol/api/players?kinopoisk=2000102&n=0",
      "https://a.ddbb.live/api/players?kinopoisk=2000102&n=0",
    ]);
    assert.equal(result.sourceUrl, urls[1]);
    assert.equal(result.players[0]?.type, "Collaps");
  }
});

test("DDBB accepts healthy empty results and isolates custom endpoints", async () => {
  for (const options of [{}, { baseUrl: "https://custom.test" }, { fallbackBaseUrls: [] }]) {
    let calls = 0;
    const config = createDdbbConfig({
      ...options,
      fetch: async () => {
        calls += 1;
        return Response.json({ data: [] });
      },
    });
    assert.deepEqual(
      (await loadDdbbPlayers(config, { source: "imdb", id: "tt0816692" }, {})).players,
      [],
    );
    assert.equal(calls, 1);
  }
  assert.deepEqual(createDdbbConfig({ baseUrl: "https://custom.test" }).fallbackBaseUrls, []);
});

test("DDBB reserves time for fallback when primary stalls", async () => {
  const hosts: string[] = [];
  const config = createDdbbConfig({
    fetch: async (input, init) => {
      hosts.push(new URL(input).hostname);
      if (hosts.length > 1) return Response.json({ data: [] });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    },
  });
  await loadDdbbPlayers(config, { source: "kinopoisk", id: "2000102" }, { timeoutMs: 100 });
  assert.deepEqual(hosts, ["p2.ddbb.lol", "a.ddbb.live"]);
});

test("DDBB does not fail over after cancellation or rate limiting and propagates final failures", async () => {
  for (const mode of ["cancel", "rate", "unavailable"]) {
    const controller = new AbortController();
    const cancellation = new Error("caller cancelled");
    let calls = 0;
    const config = createDdbbConfig({
      fetch: async () => {
        calls += 1;
        if (mode === "cancel") controller.abort(cancellation);
        return new Response(null, { status: mode === "rate" ? 429 : 503 });
      },
    });
    await assert.rejects(
      loadDdbbPlayers(
        config,
        { source: "kinopoisk", id: "2000102" },
        { signal: controller.signal },
      ),
      (error) => (mode === "cancel" ? error === cancellation : error instanceof ProviderError),
    );
    assert.equal(calls, mode === "unavailable" ? 2 : 1);
  }
});
