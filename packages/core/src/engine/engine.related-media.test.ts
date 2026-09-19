import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryCache } from "../cache/index.js";
import { MediaEngineError, ProviderError } from "../errors/index.js";
import type { MediaProvider, ProviderRelatedMediaResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";

function createRelatedProvider(
  name: string,
  getRelatedMedia: MediaProvider["getRelatedMedia"],
): MediaProvider {
  return {
    name,
    kind: "metadata",
    capabilities: {
      mediaTypes: ["anime"],
      search: { byTitle: false, byExternalIds: ["shikimori"] },
      details: { byExternalIds: ["shikimori"] },
      relatedMedia: { byExternalIds: ["shikimori"] },
      features: ["relations"],
    },
    async search() {
      return [];
    },
    getRelatedMedia,
  };
}

function result(provider: string, title: string): ProviderRelatedMediaResult {
  return {
    provider,
    relations: [
      {
        kind: "sequel",
        item: {
          id: `${provider}:59978`,
          type: "anime",
          title,
          ids: { shikimori: "59978" },
          animeKind: "tv",
          status: "ongoing",
          episodesCount: 10,
        },
        source: {
          provider,
          ids: { shikimori: "59978" },
          url: `https://${provider}.example/animes/59978`,
        },
      },
    ],
  };
}

test("getRelatedMedia normalizes, deduplicates, attributes, caches, and preserves query identity", async () => {
  let calls = 0;
  const first = createRelatedProvider("first", async (query) => {
    calls += 1;
    assert.deepEqual(query, {
      ids: { shikimori: "52991" },
      type: "anime",
      language: "ru",
      limit: 10,
    });
    return result("first", "Провожающая в последний путь Фрирен 2");
  });
  const second = createRelatedProvider("second", async () => ({
    ...result("second", "Frieren: Beyond Journey's End Season 2"),
    relations: [
      ...result("second", "Frieren: Beyond Journey's End Season 2").relations,
      {
        kind: "side_story",
        item: {
          id: "second:side-story",
          type: "anime",
          title: "Frieren side story",
          ids: { shikimori: "60000" },
          animeKind: "special",
        },
      },
    ],
  }));
  const engine = new MediaEngine({ providers: [first, second], cache: new MemoryCache() });

  const response = await engine.getRelatedMedia({
    shikimori: " 52991 ",
    type: "anime",
    language: "RU",
    limit: 10,
  });

  assert.equal(response.relations.length, 2);
  assert.equal(response.relations[0]?.kind, "sequel");
  assert.equal(response.relations[0]?.item.title, "Провожающая в последний путь Фрирен 2");
  assert.equal(response.relations[0]?.item.ids?.shikimori, "59978");
  assert.deepEqual(
    response.relations[0]?.sources.map((source) => source.provider),
    ["first", "second"],
  );
  assert.equal(response.relations[1]?.kind, "side_story");
  assert.deepEqual(response.meta.providers.successful, ["first", "second"]);
  assert.equal(response.meta.cached, false);

  const cached = await engine.getRelatedMedia({
    ids: { shikimori: "52991" },
    type: "anime",
    language: "ru",
    limit: 10,
  });
  assert.equal(cached.meta.cached, true);
  assert.equal(calls, 1);
});

test("getRelatedMedia isolates partial provider failures and rejects total failure", async () => {
  const failing = createRelatedProvider("failing", async () => {
    throw new ProviderError({
      provider: "failing",
      code: "PROVIDER_UNAVAILABLE",
      message: "temporary outage",
      retryable: true,
    });
  });
  const healthy = createRelatedProvider("healthy", async () => result("healthy", "Season 2"));
  const partialEngine = new MediaEngine({ providers: [failing, healthy] });

  const partial = await partialEngine.getRelatedMedia({ shikimori: "52991" });
  assert.equal(partial.relations.length, 1);
  assert.equal(partial.meta.providers.failed[0]?.code, "PROVIDER_UNAVAILABLE");

  const failedEngine = new MediaEngine({ providers: [failing] });
  await assert.rejects(
    failedEngine.getRelatedMedia({ shikimori: "52991" }),
    (error: unknown) =>
      error instanceof MediaEngineError &&
      error.code === "PROVIDER_ERROR" &&
      error.message === "All related media providers failed.",
  );
});

test("getRelatedMedia validates bounds, supports zero limit, and ignores incapable providers", async () => {
  const provider = createRelatedProvider("related", async () => result("related", "Season 2"));
  const engine = new MediaEngine({ providers: [provider] });

  await assert.rejects(engine.getRelatedMedia({}), /must include external ids/);
  await assert.rejects(
    engine.getRelatedMedia({ shikimori: "52991", limit: 101 }),
    /between 0 and 100/,
  );

  const zero = await engine.getRelatedMedia({ shikimori: "52991", limit: 0 });
  assert.deepEqual(zero.relations, []);

  const unsupported = await engine.getRelatedMedia({ imdb: "tt0388629", type: "anime" });
  assert.deepEqual(unsupported.relations, []);
  assert.deepEqual(unsupported.meta.providers.requested, []);
});

test("getRelatedMedia propagates caller cancellation", async () => {
  const provider = createRelatedProvider("slow", async (_query, context) => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 5_000);
      context.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(context.signal?.reason);
        },
        { once: true },
      );
    });
    return result("slow", "Season 2");
  });
  const engine = new MediaEngine({ providers: [provider] });
  const controller = new AbortController();
  const pending = engine.getRelatedMedia({ shikimori: "52991" }, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending);
});
