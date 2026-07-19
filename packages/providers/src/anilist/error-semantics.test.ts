import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockProvider, MediaEngine, MemoryCache } from "@media-engine/core";

import { aniListProvider } from "./index.js";

test("aniListProvider classifies HTTP-200 GraphQL rate limits as retryable", async () => {
  const provider = createProvider({
    errors: [
      {
        message: "Too Many Requests.",
        status: 429,
        extensions: { code: "RATE_LIMITED", retryAfterMs: 0 },
      },
    ],
  });

  await assert.rejects(() => provider.search({ title: "One Piece" }, {}), {
    name: "ProviderError",
    provider: "anilist",
    code: "PROVIDER_RATE_LIMITED",
    retryable: true,
  });
});

test("aniListProvider classifies HTTP-200 GraphQL server errors as retryable", async () => {
  const provider = createProvider({
    errors: [
      {
        message: "Internal server error.",
        extensions: { code: "INTERNAL_SERVER_ERROR", status: 503 },
      },
    ],
  });

  await assert.rejects(() => provider.search({ title: "One Piece" }, {}), {
    name: "ProviderError",
    provider: "anilist",
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
  });
});

test("aniListProvider classifies GraphQL validation errors as non-retryable", async () => {
  const provider = createProvider({
    errors: [
      {
        message: 'Cannot query field "unknown" on type "Media".',
        extensions: { code: "GRAPHQL_VALIDATION_FAILED", status: 400 },
      },
    ],
  });

  await assert.rejects(() => provider.search({ title: "One Piece" }, {}), {
    name: "ProviderError",
    provider: "anilist",
    code: "PROVIDER_ERROR",
    retryable: false,
  });
});

test("aniListProvider rejects a malformed GraphQL payload", async () => {
  const provider = createProvider({});

  await assert.rejects(() => provider.search({ title: "One Piece" }, {}), {
    name: "ProviderError",
    provider: "anilist",
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: false,
  });
});

test("aniListProvider rejects malformed GraphQL error entries", async () => {
  const provider = createProvider({ errors: [{}] });

  await assert.rejects(() => provider.search({ title: "One Piece" }, {}), {
    name: "ProviderError",
    provider: "anilist",
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: false,
  });
});

test("AniList retryable GraphQL degradation is not cached as a complete engine response", async () => {
  let stableCalls = 0;
  let aniListCalls = 0;
  const anilist = aniListProvider({
    baseUrl: "https://anilist.test",
    fetch: async () => {
      aniListCalls += 1;

      if (aniListCalls === 1) {
        return Response.json({
          errors: [
            {
              message: "Too Many Requests.",
              status: 429,
              extensions: { code: "RATE_LIMITED", retryAfterMs: 0 },
            },
          ],
        });
      }

      return Response.json({
        data: {
          Media: {
            id: 1535,
            idMal: 1535,
            title: { romaji: "Death Note", english: "Death Note" },
            format: "TV",
            startDate: { year: 2006, month: 10, day: 4 },
            description: "Recovered AniList description.",
          },
        },
      });
    },
  });
  const stable = createMockProvider({
    name: "stable-provider",
    capabilities: {
      mediaTypes: ["anime"],
      details: { byExternalIds: ["myAnimeList"] },
    },
    getDetails() {
      stableCalls += 1;
      return {
        provider: "stable-provider",
        details: {
          id: "stable-death-note",
          type: "anime",
          title: "Death Note",
          year: 2006,
          ids: { myAnimeList: "1535" },
        },
      };
    },
  });
  const engine = new MediaEngine({ cache: new MemoryCache(), providers: [stable, anilist] });

  const first = await engine.getDetails({ myAnimeList: "1535", type: "anime" });
  const second = await engine.getDetails({ myAnimeList: "1535", type: "anime" });
  const third = await engine.getDetails({ myAnimeList: "1535", type: "anime" });

  assert.equal(first.meta.cached, false);
  assert.equal(first.meta.providers.failed[0]?.code, "PROVIDER_RATE_LIMITED");
  assert.equal(second.meta.cached, false);
  assert.equal(second.meta.providers.failed.length, 0);
  assert.equal(second.details?.description, "Recovered AniList description.");
  assert.equal(third.meta.cached, true);
  assert.equal(stableCalls, 2);
  assert.equal(aniListCalls, 2);
});

function createProvider(response: unknown) {
  return aniListProvider({
    baseUrl: "https://anilist.test",
    fetch: async () => Response.json(response),
  });
}
