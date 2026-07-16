import assert from "node:assert/strict";
import { test } from "node:test";

import type { KinoBdPlayerAudit } from "./index.js";
import { createProvider } from "./test-helpers.js";

test("kinobdStreamingProvider filters clearly broken player pages", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  const provider = createProvider({
    onPlayerAudit(value) {
      audit = value;
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [
            {
              id: 153327,
              kinopoisk_id: 382731,
              title: "Ван-Пис",
              name_original: "One Piece",
              year: 1999,
              iframe: '<iframe src="//kinobd.test/player/153327"></iframe>',
            },
          ],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          ashdi: {
            translate: "багатоголосий закадровий",
            iframe: "https://kinobd.test/external_player/ashdi/382731",
            quality: "auto",
          },
          hdvb: {
            translate: "одноголосый закадровый",
            iframe: "https://hdvb.test/broken/iframe",
            quality: "HDTVRip",
          },
          netflix: {
            translate: "Netflix",
            iframe: "https://netflix.test/title/382731",
          },
          vibix: {
            translate: "Дубляж",
          },
          kodik: {
            translate: "Shachiburi",
            iframe: "https://kodik.test/serial/52881/720p",
            quality: "720p",
          },
        });
      }

      if (String(input) === "https://kinobd.test/external_player/ashdi/382731") {
        return new Response('<iframe src="https://ashdi.test/serial/1381"></iframe>', {
          headers: {
            "content-type": "text/html",
          },
        });
      }

      if (String(input) === "https://ashdi.test/serial/1381") {
        return new Response("<html><body><h1>Плеєр недоступний для перегляду</h1></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        });
      }

      if (String(input) === "https://hdvb.test/broken/iframe") {
        return new Response("<html><body><h1>404 Not Found!</h1></body></html>", {
          status: 404,
          headers: {
            "content-type": "text/html",
          },
        });
      }

      if (String(input) === "https://kodik.test/serial/52881/720p") {
        return new Response("<html><body>Kodik player</body></html>", {
          headers: {
            "content-type": "text/html",
          },
        });
      }

      return new Response("{}", { status: 404 });
    },
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      ids: {
        kinopoisk: "382731",
      },
    },
    {},
  );

  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["KODIK"],
  );
  assert.deepEqual(audit, {
    query: {
      type: "anime",
      ids: {
        kinopoisk: "382731",
      },
    },
    discovered: ["ASHDI", "HDVB", "NETFLIX", "VIBIX", "KODIK"],
    shown: ["KODIK"],
    filtered: [
      {
        player: "NETFLIX",
        reason: "provider_not_allowed",
      },
      {
        player: "VIBIX",
        reason: "missing_iframe",
      },
      {
        player: "ASHDI",
        reason: "player_validation_failed",
        url: "https://kinobd.test/external_player/ashdi/382731",
      },
      {
        player: "HDVB",
        reason: "player_validation_failed",
        url: "https://hdvb.test/broken/iframe",
      },
    ],
  });
});

test("kinobdStreamingProvider filters known broken HDVB hosts when validation fetch fails", async () => {
  const provider = createProvider({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [
            {
              id: 153327,
              kinopoisk_id: 382731,
              title: "Ван-Пис",
              name_original: "One Piece",
              year: 1999,
              iframe: '<iframe src="//kinobd.test/player/153327"></iframe>',
            },
          ],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          hdvb: {
            translate: "одноголосый закадровый",
            iframe: "https://vid1783527725.sevstar933krop.com/serial/hash/iframe?d=kinobd.ru",
            quality: "HDTVRip",
          },
        });
      }

      if (String(input).includes("sevstar933krop.com")) {
        throw new TypeError("fetch failed");
      }

      return new Response("{}", { status: 404 });
    },
  });

  const availability = await provider.getAvailability(
    {
      type: "anime",
      ids: {
        kinopoisk: "382731",
      },
    },
    {},
  );

  assert.deepEqual(availability?.options, []);
});

test("kinobdStreamingProvider limits live player validation fan-out", async () => {
  const validatedUrls: string[] = [];
  const provider = createProvider({
    playerValidationLimit: 1,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [
            {
              id: 94666,
              kinopoisk_id: 258687,
              title: "Интерстеллар",
              name_original: "Interstellar",
              year: 2014,
              iframe: '<iframe src="//kinobd.test/player/94666"></iframe>',
            },
          ],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          collaps: {
            translate: "Дубляж",
            iframe: "https://collaps.test/video/94666",
            quality: "1080p",
          },
          flixcdn: {
            translate: "LostFilm",
            iframe: "https://flixcdn.test/video/94666",
            quality: "1080p",
          },
          hdvb: {
            translate: "одноголосый закадровый",
            iframe: "https://vid1783527725.sevstar933krop.com/serial/hash/iframe?d=kinobd.ru",
            quality: "HDTVRip",
          },
        });
      }

      validatedUrls.push(String(input));

      return new Response("<html><body>Player</body></html>", {
        headers: {
          "content-type": "text/html",
        },
      });
    },
  });

  const availability = await provider.getAvailability(
    {
      type: "movie",
      ids: {
        kinopoisk: "258687",
      },
    },
    {},
  );

  assert.deepEqual(validatedUrls, ["https://collaps.test/video/94666"]);
  assert.deepEqual(
    availability?.options.map((option) => option.player.label),
    ["COLLAPS", "FLIXCDN"],
  );
});

test("kinobdStreamingProvider aborts live validation with the provider context", async () => {
  const controller = new AbortController();
  let validationAborted = false;
  const provider = createProvider({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [
            {
              id: 94666,
              kinopoisk_id: 258687,
              title: "Интерстеллар",
              year: 2014,
            },
          ],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          collaps: {
            translate: "Дубляж",
            iframe: "https://collaps.test/video/94666",
          },
        });
      }

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            validationAborted = true;
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    },
  });

  const availabilityPromise = provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 5);

  await availabilityPromise;

  assert.equal(validationAborted, true);
});
