import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngine } from "../engine/index.js";
import { sampleAnime, sampleMovie, sampleSeries } from "./fixtures.js";
import {
  createFailingProvider,
  createMockProvider,
  createSuccessProvider,
  createTimeoutProvider,
} from "./providers.js";

test("fixtures cover movie series and anime basics", () => {
  assert.equal(sampleMovie.type, "movie");
  assert.equal(sampleMovie.title, "Interstellar");
  assert.equal(sampleSeries.type, "series");
  assert.equal(sampleSeries.seasonsCount, 5);
  assert.equal(sampleAnime.type, "anime");
  assert.equal(sampleAnime.episodesCount, 64);
});

test("createMockProvider returns deterministic search and details results", async () => {
  const provider = createMockProvider({ name: "fixture-provider" });

  const searchResults = await provider.search({ title: "Interstellar" }, {});
  const detailsResult = await provider.getDetails?.({ ids: { imdb: "tt0816692" } }, {});

  assert.equal(searchResults[0]?.provider, "fixture-provider");
  assert.equal(searchResults[0]?.item.title, sampleMovie.title);
  assert.equal(detailsResult?.provider, "fixture-provider");
  assert.equal(detailsResult?.details.title, sampleMovie.title);
});

test("success provider works with MediaEngine without real HTTP", async () => {
  const engine = new MediaEngine({
    providers: [createSuccessProvider()],
  });

  const response = await engine.search({ title: "Interstellar" });

  assert.equal(response.results.length, 1);
  assert.equal(response.meta.providers.successful[0], "success-provider");
});

test("failing provider creates reusable failure scenarios", async () => {
  const engine = new MediaEngine({
    providers: [createFailingProvider({ message: "Reusable failure." })],
  });

  await assert.rejects(
    () => engine.search({ title: "Interstellar" }),
    /All search providers failed/,
  );
});

test("timeout provider creates reusable timeout scenarios", async () => {
  const engine = new MediaEngine({
    timeoutMs: 1,
    providers: [createTimeoutProvider({ delayMs: 60_000 })],
  });

  await assert.rejects(
    () => engine.search({ title: "Interstellar" }),
    /All search providers failed/,
  );
});
