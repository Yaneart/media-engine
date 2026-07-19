import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderFetch } from "../shared/index.js";
import {
  flixHqStreamingProvider,
  parseEpisodes,
  parseSearchCandidates,
  parseSubtitleInfo,
} from "./index.js";

const BASE_URL = "https://flixhq.test";

test("flixHqStreamingProvider exposes no-token embed capabilities", () => {
  const provider = flixHqStreamingProvider({ baseUrl: BASE_URL });

  assert.equal(provider.name, "flixhq-streaming");
  assert.deepEqual(provider.capabilities.mediaTypes, ["movie", "series"]);
  assert.equal(provider.capabilities.lookup.byTitle, true);
  assert.equal(provider.capabilities.lookup.byEpisode, true);
  assert.equal(provider.capabilities.features?.includes("embed"), true);
  assert.equal(provider.capabilities.features?.includes("hls"), true);
  assert.equal(provider.capabilities.features?.includes("subtitles"), true);
  assert.equal(provider.capabilities.features?.includes("qualities"), true);
  assert.equal(provider.capabilities.features?.includes("headers"), true);
});

test("flixHqStreamingProvider fetches and normalizes sub.info tracks", async () => {
  const subtitleInfoUrl = "https://captions.test/subtitles/token.json";
  const embedUrl = `https://player.test/embed/inception?sub.info=${encodeURIComponent(subtitleInfoUrl)}`;
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async (input) => {
      const url = new URL(input.toString());
      if (url.href === subtitleInfoUrl) {
        return Response.json([
          {
            file: "https://captions.test/files/inception-en.vtt",
            label: "English",
            kind: "captions",
            default: true,
          },
          {
            file: "https://captions.test/files/inception-es.srt",
            label: "Spanish",
          },
        ]);
      }
      if (url.hostname === "player.test") return new Response("<html>player</html>");
      if (url.pathname === "/search") {
        return new Response(
          searchHtml([["Inception", "/watch-movie/inception-2010-watch-online/"]]),
        );
      }
      if (url.pathname.includes("/watch-movie/")) return new Response(movieHtml("token"));
      if (url.pathname === "/ajax/ajax.php") {
        return Response.json({ name: "FlixHQ", link: embedUrl });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const result = await provider.getAvailability(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.deepEqual(result?.options[0]?.subtitles, [
    {
      language: "en",
      label: "English (default)",
      format: "vtt",
      url: "https://captions.test/files/inception-en.vtt",
    },
    {
      language: "es",
      label: "Spanish",
      format: "srt",
      url: "https://captions.test/files/inception-es.srt",
    },
  ]);
});

test("flixHqStreamingProvider maps explicit direct streams without resolving protected embeds", async () => {
  const expires = 1_800_000_000;
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    fetch: async (input, init) => {
      const url = new URL(input.toString());
      if (url.hostname === "media.test") {
        assert.equal(new Headers(init?.headers).get("range"), "bytes=0-0");
        return new Response("#EXTM3U", { status: 206 });
      }
      if (url.pathname === "/search") {
        return new Response(
          searchHtml([["Inception", "/watch-movie/inception-2010-watch-online/"]]),
        );
      }
      if (url.pathname.includes("/watch-movie/")) return new Response(movieHtml("token"));
      if (url.pathname === "/ajax/ajax.php") {
        return Response.json({
          name: "FlixHQ 1080p",
          link: `https://media.test/inception/master.m3u8?expires=${expires}`,
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const result = await provider.getAvailability(
    { type: "movie", title: "Inception", year: 2010 },
    {},
  );

  assert.equal(result?.options[0]?.player.kind, "hls");
  assert.deepEqual(result?.options[0]?.quality, { label: "1080p", height: 1080 });
  assert.equal(result?.options[0]?.expiresAt, "2027-01-15T08:00:00.000Z");
});

test("parseSubtitleInfo rejects malformed, duplicate, and unsafe tracks", () => {
  assert.deepEqual(parseSubtitleInfo("not json"), []);
  assert.deepEqual(
    parseSubtitleInfo(
      JSON.stringify([
        { file: "javascript:alert(1)", label: "Unsafe" },
        { file: "http://169.254.169.254/latest/meta-data", label: "Private network" },
        { file: "https://captions.test/en.ass", label: "Russian" },
        { file: "https://captions.test/en.ass", label: "Duplicate" },
      ]),
    ),
    [
      {
        language: "ru",
        label: "Russian",
        format: "ass",
        url: "https://captions.test/en.ass",
      },
    ],
  );
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
          { name: "Private", link: "http://127.0.0.1:3000/admin" },
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
  assert.deepEqual(
    (await provider.getAvailability({ type: "series", title: "Game of Thrones" }, {}))?.options,
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
  assert.throws(
    () => flixHqStreamingProvider({ baseUrl: BASE_URL, subtitleInfoMaxBytes: 0 }),
    /subtitleInfoMaxBytes/,
  );
  assert.throws(() => flixHqStreamingProvider({ baseUrl: "file:///tmp/flixhq" }), /HTTP or HTTPS/);
});

test("FlixHQ stops reading chunked primary HTML after the configured limit", async () => {
  let enqueuedBytes = 0;
  let cancelled = false;
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    maxHtmlBytes: 10,
    fetch: async () => {
      const chunks = [new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)];
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              const chunk = chunks.shift();
              if (!chunk) {
                controller.close();
                return;
              }
              enqueuedBytes += chunk.byteLength;
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  });

  await assert.rejects(() => provider.getAvailability({ type: "movie", title: "Inception" }, {}), {
    code: "PROVIDER_RESPONSE_TOO_LARGE",
  });
  assert.ok(enqueuedBytes <= 16, `FlixHQ enqueued ${enqueuedBytes} bytes`);
  assert.equal(cancelled, true);
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
