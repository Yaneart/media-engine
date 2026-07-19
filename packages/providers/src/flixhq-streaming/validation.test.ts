import assert from "node:assert/strict";
import { test } from "node:test";

import { flixHqStreamingProvider } from "./index.js";

const BASE_URL = "https://flixhq.test";

test("flixHqStreamingProvider removes confirmed missing players and keeps transient failures unknown", async () => {
  const provider = flixHqStreamingProvider({
    baseUrl: BASE_URL,
    playerValidationTimeoutMs: 5,
    fetch: async (input, init) => {
      const url = new URL(input.toString());

      if (url.hostname === "missing.test") return new Response("Not found", { status: 404 });
      if (url.hostname === "gone.test") return new Response("Gone", { status: 410 });
      if (url.hostname === "server.test") return new Response("Unavailable", { status: 503 });
      if (url.hostname === "limited.test") return new Response("Limited", { status: 429 });
      if (url.hostname === "network.test") throw new TypeError("fetch failed");
      if (url.hostname === "timeout.test") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      if (url.hostname === "working.test") return new Response("<html>player</html>");
      if (url.pathname === "/search") {
        return new Response(
          '<article><a href="https://flixhq.test/watch-movie/inception-2010-watch-online/" title="Inception Watch Online Full Movie HD">Inception</a></article>',
        );
      }
      if (url.pathname.includes("/watch-movie/")) {
        return new Response(
          '<div id="main-wrapper" class="page-detail" data-token="movie-token"></div>',
        );
      }
      if (url.pathname === "/ajax/ajax.php") {
        return Response.json([
          { name: "Missing", link: "https://missing.test/embed" },
          { name: "Gone", link: "https://gone.test/embed" },
          { name: "Server", link: "https://server.test/embed" },
          { name: "Limited", link: "https://limited.test/embed" },
          { name: "Network", link: "https://network.test/embed" },
          { name: "Timeout", link: "https://timeout.test/embed" },
          { name: "Working", link: "https://working.test/embed" },
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
    result?.options.map((option) => [option.player.label, option.availability]),
    [
      ["Server", "unknown"],
      ["Limited", "unknown"],
      ["Network", "unknown"],
      ["Timeout", "unknown"],
      ["Working", "available"],
    ],
  );
});
