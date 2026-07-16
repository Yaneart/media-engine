import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngineError } from "../errors/index.js";
import type { ProviderSearchResult } from "../providers/index.js";
import { MediaEngine } from "./engine.js";
import { createProvider } from "./test-helpers.js";

test("search rejects empty queries predictably", async () => {
  const engine = new MediaEngine();

  await assert.rejects(() => engine.search({}), {
    name: "MediaEngineError",
    code: "INVALID_QUERY",
    message: "Search query must include title or external ids.",
  });
});

test("search rejects limits that could amplify provider and merge work", async () => {
  const engine = new MediaEngine();

  await assert.rejects(
    engine.search({ title: "Interstellar", limit: 101 }),
    (error: unknown) =>
      error instanceof MediaEngineError &&
      error.code === "INVALID_QUERY" &&
      error.message.includes("between 0 and 100"),
  );
});

test("search normalizes top-level external id shortcuts into ids", async () => {
  let receivedIds: unknown;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedIds = query.ids;
          return [
            {
              provider: "imdb-provider",
              item: {
                id: "imdb-tt0816692",
                type: "movie",
                title: "Interstellar",
                ids: { imdb: "tt0816692" },
              },
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ imdb: "tt0816692" });

  assert.deepEqual(receivedIds, { imdb: "tt0816692" });
  assert.deepEqual(response.query.ids, { imdb: "tt0816692" });
  assert.equal(response.results.length, 1);
});

test("search infers provider context language from the title script", async () => {
  const receivedLanguages: Array<string | undefined> = [];
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(_query, context): Promise<ProviderSearchResult[]> {
          receivedLanguages.push(context.language);
          return [];
        },
      }),
    ],
  });

  await engine.search({ title: "интерстеллар" });
  await engine.search({ title: "Interstellar" });
  await engine.search({ title: "進撃の巨人" });

  assert.deepEqual(receivedLanguages, ["ru", "en", "ja"]);
});

test("search widens provider limit before applying public response limit", async () => {
  let receivedLimit: number | undefined;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedLimit = query.limit;
          return [
            {
              provider: "test-provider",
              item: {
                id: "movie-1",
                type: "movie",
                title: "Weak Result",
              },
              confidence: 0.2,
            },
            {
              provider: "test-provider",
              item: {
                id: "movie-2",
                type: "movie",
                title: "Interstellar",
              },
              confidence: 0.9,
            },
          ];
        },
      }),
    ],
  });

  const response = await engine.search({ title: "Interstellar", limit: 1 });

  assert.equal(receivedLimit, 10);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.item.title, "Interstellar");
});

test("search widens short broad title queries more aggressively", async () => {
  let receivedLimit: number | undefined;
  const engine = new MediaEngine({
    providers: [
      createProvider({
        async search(query): Promise<ProviderSearchResult[]> {
          receivedLimit = query.limit;
          return [];
        },
      }),
    ],
  });

  await engine.search({ title: "one", limit: 5 });

  assert.equal(receivedLimit, 50);
});
