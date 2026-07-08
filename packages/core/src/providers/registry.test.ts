import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderRegistry } from "./registry.js";
import type { MediaProvider } from "./types.js";

function createProvider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    name: "test-provider",
    kind: "metadata",
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb", "tmdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
    },
    async search() {
      return [];
    },
    async getDetails() {
      return null;
    },
    ...overrides,
  };
}

test("rejects duplicate provider names", () => {
  assert.throws(
    () =>
      new ProviderRegistry([createProvider({ name: "tmdb" }), createProvider({ name: "tmdb" })]),
    /already registered/,
  );
});

test("rejects blank or padded provider names", () => {
  assert.throws(() => new ProviderRegistry([createProvider({ name: " " })]), /name is required/);
  assert.throws(
    () => new ProviderRegistry([createProvider({ name: " tmdb" })]),
    /must not include/,
  );
});

test("returns safe provider info", () => {
  const registry = new ProviderRegistry([
    createProvider({
      name: "tmdb",
      version: "1.0.0",
    }),
  ]);

  assert.deepEqual(registry.getProviders(), [
    {
      name: "tmdb",
      version: "1.0.0",
      kind: "metadata",
      capabilities: {
        mediaTypes: ["movie", "series", "anime"],
        search: {
          byTitle: true,
          byExternalIds: ["imdb", "tmdb"],
        },
        details: {
          byExternalIds: ["imdb"],
        },
        features: undefined,
      },
    },
  ]);
});

test("selects search providers by title support", () => {
  const titleProvider = createProvider({ name: "title-provider" });
  const idOnlyProvider = createProvider({
    name: "id-only-provider",
    capabilities: {
      mediaTypes: ["movie"],
      search: {
        byTitle: false,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
    },
  });

  const registry = new ProviderRegistry([titleProvider, idOnlyProvider]);

  assert.deepEqual(registry.selectSearchProviders({ title: "Interstellar" }), [titleProvider]);
});

test("selects search providers by external ids", () => {
  const imdbProvider = createProvider({ name: "imdb-provider" });
  const shikimoriProvider = createProvider({
    name: "shikimori-provider",
    capabilities: {
      mediaTypes: ["anime"],
      search: {
        byTitle: true,
        byExternalIds: ["shikimori"],
      },
      details: {
        byExternalIds: ["shikimori"],
      },
    },
  });

  const registry = new ProviderRegistry([imdbProvider, shikimoriProvider]);

  assert.deepEqual(registry.selectSearchProviders({ ids: { imdb: "tt0816692" } }), [imdbProvider]);
});

test("respects media type capabilities during search selection", () => {
  const movieProvider = createProvider({
    name: "movie-provider",
    capabilities: {
      mediaTypes: ["movie"],
      search: {
        byTitle: true,
        byExternalIds: ["imdb"],
      },
      details: {
        byExternalIds: ["imdb"],
      },
    },
  });

  const animeProvider = createProvider({
    name: "anime-provider",
    capabilities: {
      mediaTypes: ["anime"],
      search: {
        byTitle: true,
        byExternalIds: ["shikimori"],
      },
      details: {
        byExternalIds: ["shikimori"],
      },
    },
  });

  const registry = new ProviderRegistry([movieProvider, animeProvider]);

  assert.deepEqual(registry.selectSearchProviders({ title: "Naruto", type: "anime" }), [
    animeProvider,
  ]);
});

test("selects details providers with getDetails and matching external ids", () => {
  const detailsProvider = createProvider({ name: "details-provider" });
  const searchOnlyProvider = createProvider({
    name: "search-only-provider",
    getDetails: undefined,
  });

  const registry = new ProviderRegistry([detailsProvider, searchOnlyProvider]);

  assert.deepEqual(registry.selectDetailsProviders({ ids: { imdb: "tt0816692" } }), [
    detailsProvider,
  ]);
});
