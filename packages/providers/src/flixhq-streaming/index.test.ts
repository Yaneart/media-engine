import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderFetch } from "../shared/index.js";
import { flixHqStreamingProvider, parseEpisodes, parseSearchCandidates } from "./index.js";

const BASE_URL = "https://flixhq.test";

test("flixHqStreamingProvider exposes no-token embed capabilities", () => {
  const provider = flixHqStreamingProvider({ baseUrl: BASE_URL });

  assert.equal(provider.name, "flixhq-streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
  assert.equal(provider.capabilities.features?.includes("embed"), true);
  assert.equal(provider.capabilities.features?.includes("headers"), true);
});

test("flixHqStreamingProvider maps movie player tokens into embed options", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: createFetch(
      {
        "/search?keyword=Inception": searchHtml([
          ["Inception", "/watch-movie/inception-2010-watch-online/"],
          ["Inception Point", "/watch-movie/inception-point-2025-watch-online/"],
        ]),
        "/watch-movie/inception-2010-watch-online/": movieHtml("movie-token"),
        "/ajax/ajax.php": JSON.stringify([
          { name: "VidCloud", link: "https://vidcloud.test/embed/inception" },
          { name: "UpCloud", link: "https://upcloud.test/embed/inception" },
          { name: "Broken", link: "javascript:alert(1)" },
        ]),
      },
      requests,
    ),
  });

  const result = await provider.getAvailability(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.equal(result?.item?.title, "Inception");
  assert.equal(result?.item?.year, 2010);
  assert.deepEqual(
    result?.options.map((option) => [option.player.label, option.access.url]),
    [
      ["VidCloud", "https://vidcloud.test/embed/inception"],
      ["UpCloud", "https://upcloud.test/embed/inception"],
    ],
  );
  assert.equal(result?.options[0]?.access.referer, `${BASE_URL}/`);
  assert.equal(result?.options[0]?.translation?.language, undefined);
  assert.equal(requests[2]?.init?.method, "POST");
  assert.equal(requests[2]?.init?.body, "players=movie-token");
});

test("flixHqStreamingProvider selects a requested series episode and uses players_show", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: createFetch(
      {
        "/search?keyword=House+of+the+Dragon": searchHtml([
          ["House of the Dragon", "/watch-series/house-of-the-dragon-2022-watch-online/"],
        ]),
        "/watch-series/house-of-the-dragon-2022-watch-online/": seriesHtml(),
        "/episode/house-of-the-dragon-2022-watch-online/s02-e03/":
          '<div id="series-player" class="w_b-player" data-token="episode-token"></div>',
        "/ajax/ajax.php": JSON.stringify({
          name: "English server",
          link: "https://player.test/embed/house-of-the-dragon-s02e03",
        }),
      },
      requests,
    ),
  });

  const result = await provider.getAvailability(
    {
      type: "series",
      title: "House of the Dragon",
      year: 2022,
      seasonNumber: 2,
      episodeNumber: 3,
    },
    {},
  );

  assert.equal(result?.options.length, 1);
  assert.deepEqual(result?.options[0]?.episode, { seasonNumber: 2, episodeNumber: 3 });
  assert.equal(result?.episodes?.[0]?.title, "Eps 3: The Burning Mill");
  assert.equal(requests[3]?.init?.body, "players_show=episode-token");
});

test("flixHqStreamingProvider respects provider filters and unsupported anime", async () => {
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async () => {
      throw new Error("fetch should not be called");
    },
  });

  assert.equal(
    await provider.getAvailability(
      { type: "movie", title: "Inception", providers: ["another-provider"] },
      {},
    ),
    null,
  );
  assert.deepEqual(
    (await provider.getAvailability({ type: "anime", title: "One Piece" }, {}))?.options,
    [],
  );
});

test("flixHqStreamingProvider filters confirmed unavailable players", async () => {
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "missing.test") return new Response("Not found", { status: 404 });
      if (url.hostname === "deleted.test") return new Response("This file has been deleted");
      if (url.hostname === "working.test") return new Response("<html>player</html>");
      if (url.pathname === "/search") {
        return new Response(
          searchHtml([["Inception", "/watch-movie/inception-2010-watch-online/"]]),
        );
      }
      if (url.pathname.includes("/watch-movie/")) return new Response(movieHtml("token"));
      if (url.pathname === "/ajax/ajax.php") {
        return Response.json([
          { name: "Missing", link: "https://missing.test/embed/1" },
          { name: "Deleted", link: "https://deleted.test/embed/1" },
          { name: "Working", link: "https://working.test/embed/1" },
        ]);
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const result = await provider.getAvailability(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.deepEqual(
    result?.options.map((option) => option.player.label),
    ["Working"],
  );
});

test("flixHqStreamingProvider bounds player validation concurrency", async () => {
  let activeValidations = 0;
  let maximumValidations = 0;
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    playerValidationConcurrency: 2,
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.hostname.endsWith("player.test")) {
        activeValidations += 1;
        maximumValidations = Math.max(maximumValidations, activeValidations);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeValidations -= 1;
        return new Response("<html>player</html>");
      }
      if (url.pathname === "/search") {
        return new Response(
          searchHtml([["Inception", "/watch-movie/inception-2010-watch-online/"]]),
        );
      }
      if (url.pathname.includes("/watch-movie/")) return new Response(movieHtml("token"));
      if (url.pathname === "/ajax/ajax.php") {
        return Response.json(
          Array.from({ length: 5 }, (_, index) => ({
            name: `Player ${index + 1}`,
            link: `https://${index + 1}.player.test/embed`,
          })),
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const result = await provider.getAvailability(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.equal(result?.options.length, 5);
  assert.equal(maximumValidations, 2);
});

test("FlixHQ parsers recognize current movie, series, season, and episode URLs", () => {
  assert.deepEqual(
    parseSearchCandidates(
      searchHtml([
        ["Inception", "/watch-movie/inception-2010-watch-online/"],
        ["Silo", "/watch-series/silo-2023-watch-online/"],
      ]),
    ).map(({ title, type, year }) => ({ title, type, year })),
    [
      { title: "Inception", type: "movie", year: 2010 },
      { title: "Silo", type: "series", year: 2023 },
    ],
  );
  assert.deepEqual(
    parseEpisodes(seriesHtml()).map(({ seasonNumber, episodeNumber }) => ({
      seasonNumber,
      episodeNumber,
    })),
    [
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 2, episodeNumber: 3 },
    ],
  );
});

test("flixHqStreamingProvider validates bounded configuration", () => {
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, playerLimit: 0 }),
    /playerLimit/,
  );
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, maxHtmlBytes: -1 }),
    /maxHtmlBytes/,
  );
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, playerValidationConcurrency: 0 }),
    /playerValidationConcurrency/,
  );
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, playerValidationTimeoutMs: 0 }),
    /playerValidationTimeoutMs/,
  );
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, playerValidationMaxBytes: 0 }),
    /playerValidationMaxBytes/,
  );
  assert.throws(() => flixHqStreamingProvider({ baseUrl: "file:///tmp/flixhq" }), /HTTP or HTTPS/);
});

function searchHtml(entries: Array<[title: string, path: string]>): string {
  return entries
    .map(
      ([title, path]) =>
        `<article class="flw-item"><h3 class="film-name"><a href="${BASE_URL}${path}" title="${title} Watch Online ${path.includes("watch-series") ? "full TV Show" : "Full Movie HD"}">${title}</a></h3></article>`,
    )
    .join("\n");
}

function movieHtml(token: string): string {
  return `<div id="main-wrapper" class="page-detail" data-token="${token}"><div class="watch_block"></div></div>`;
}

function seriesHtml(): string {
  return `
    <a class="eps-item" href="${BASE_URL}/episode/house-of-the-dragon-2022-watch-online/s01-e01/" title="Eps 1: The Heirs of the Dragon">Episode 1</a>
    <a class="eps-item" href="${BASE_URL}/episode/house-of-the-dragon-2022-watch-online/s02-e03/" title="Eps 3: The Burning Mill">Episode 3</a>
  `;
}

function createFetch(
  responses: Record<string, string>,
  requests: Array<{ url: string; init?: RequestInit }>,
): ProviderFetch {
  return async (input, init) => {
    const url = new URL(input.toString());
    requests.push({ url: url.href, init });
    if (url.origin !== BASE_URL) {
      return new Response("<html>working player</html>", {
        headers: { "Content-Type": "text/html" },
      });
    }
    const key = `${url.pathname}${url.search}`;
    const body = responses[key];

    if (body === undefined) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(body, {
      headers: { "Content-Type": key === "/ajax/ajax.php" ? "application/json" : "text/html" },
    });
  };
}
