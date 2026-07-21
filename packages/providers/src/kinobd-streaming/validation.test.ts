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
    metrics: {
      discovered: 5,
      validated: 3,
      skippedByLimit: 0,
      skippedByBudget: 0,
      transientUnknown: 0,
      removedConfirmed: 2,
      childRequests: 6,
    },
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

test("kinobdStreamingProvider removes confirmed missing players and keeps transient failures unknown", async () => {
  const provider = createProvider({
    playerProviders: "collaps,flixcdn,alloha,kodik,kinotochka,turbo,videocdn",
    playerValidationTimeoutMs: 5,
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
            },
          ],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          collaps: { translate: "Missing", iframe: "https://missing.test/embed" },
          flixcdn: { translate: "Gone", iframe: "https://gone.test/embed" },
          alloha: { translate: "Server", iframe: "https://server.test/embed" },
          kodik: { translate: "Limited", iframe: "https://limited.test/embed" },
          kinotochka: { translate: "Network", iframe: "https://network.test/embed" },
          turbo: { translate: "Timeout", iframe: "https://timeout.test/embed" },
          videocdn: { translate: "Working", iframe: "https://working.test/embed" },
        });
      }

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

      return new Response("<html>player</html>");
    },
  });

  const availability = await provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    {},
  );

  assert.deepEqual(
    availability?.options.map((option) => [option.access.url, option.availability]),
    [
      ["https://server.test/embed", "unknown"],
      ["https://limited.test/embed", "unknown"],
      ["https://network.test/embed", "unknown"],
      ["https://timeout.test/embed", "unknown"],
      ["https://working.test/embed", "available"],
    ],
  );
});

test("kinobdStreamingProvider limits live player validation fan-out", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  const validatedUrls: string[] = [];
  const provider = createProvider({
    playerValidationLimit: 1,
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
  assert.deepEqual(audit?.metrics, {
    discovered: 3,
    validated: 1,
    skippedByLimit: 1,
    skippedByBudget: 0,
    transientUnknown: 0,
    removedConfirmed: 1,
    childRequests: 3,
  });
});

test("kinobdStreamingProvider bounds concurrent child player validation", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  let activeValidations = 0;
  let maxActiveValidations = 0;
  let startedValidations = 0;
  let releaseFirstBatch: () => void = () => undefined;
  const firstBatch = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });
  const provider = createProvider({
    playerValidationConcurrency: 2,
    playerProviders: "collaps,flixcdn,alloha,kodik,kinotochka,turbo",
    onPlayerAudit(value) {
      audit = value;
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [{ id: 94666, kinopoisk_id: 258687, title: "Интерстеллар", year: 2014 }],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json(
          Object.fromEntries(
            ["collaps", "flixcdn", "alloha", "kodik", "kinotochka", "turbo"].map((player) => [
              player,
              { translate: player, iframe: `https://${player}.test/embed` },
            ]),
          ),
        );
      }

      activeValidations += 1;
      startedValidations += 1;
      maxActiveValidations = Math.max(maxActiveValidations, activeValidations);

      if (startedValidations === 2) {
        releaseFirstBatch();
      }

      await firstBatch;
      activeValidations -= 1;
      return new Response("<html>player</html>");
    },
  });

  const availability = await provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    {},
  );

  assert.equal(maxActiveValidations, 2);
  assert.equal(availability?.options.length, 6);
  assert.deepEqual(audit?.metrics, {
    discovered: 6,
    validated: 6,
    skippedByLimit: 0,
    skippedByBudget: 0,
    transientUnknown: 0,
    removedConfirmed: 0,
    childRequests: 8,
  });
});

test("kinobdStreamingProvider keeps options unknown when its child request budget is exhausted", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  const provider = createProvider({
    childRequestLimit: 3,
    playerValidationConcurrency: 3,
    playerProviders: "collaps,flixcdn,kodik",
    onPlayerAudit(value) {
      audit = value;
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [{ id: 94666, kinopoisk_id: 258687, title: "Интерстеллар", year: 2014 }],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          collaps: { translate: "Collaps", iframe: "https://collaps.test/embed" },
          flixcdn: { translate: "FlixCDN", iframe: "https://flixcdn.test/embed" },
          kodik: { translate: "Kodik", iframe: "https://kodik.test/embed" },
        });
      }

      return new Response("<html>player</html>");
    },
  });

  const availability = await provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    {},
  );

  assert.deepEqual(
    availability?.options.map((option) => option.availability),
    ["available", "unknown", "unknown"],
  );
  assert.deepEqual(audit?.metrics, {
    discovered: 3,
    validated: 1,
    skippedByLimit: 0,
    skippedByBudget: 2,
    transientUnknown: 2,
    removedConfirmed: 0,
    childRequests: 3,
  });
});

test("kinobdStreamingProvider skips nested validation without a full remaining time budget", async () => {
  let audit: KinoBdPlayerAudit | undefined;
  let nestedRequested = false;
  const provider = createProvider({
    playerValidationTimeoutMs: 50,
    onPlayerAudit(value) {
      audit = value;
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (`${method} ${url.pathname}` === "GET /api/player/search") {
        return Response.json({
          data: [{ id: 94666, kinopoisk_id: 258687, title: "Интерстеллар", year: 2014 }],
        });
      }

      if (`${method} ${url.pathname}` === "POST /playerdata") {
        return Response.json({
          collaps: { translate: "Collaps", iframe: "https://collaps.test/embed" },
        });
      }

      if (url.hostname === "collaps.test") {
        return new Response('<iframe src="https://nested.test/embed"></iframe>');
      }

      nestedRequested = true;
      return new Response("<html>nested player</html>");
    },
  });

  const availability = await provider.getAvailability(
    { type: "movie", ids: { kinopoisk: "258687" } },
    { timeoutMs: 25 },
  );

  assert.equal(nestedRequested, false);
  assert.equal(availability?.options[0]?.availability, "unknown");
  assert.deepEqual(audit?.metrics, {
    discovered: 1,
    validated: 1,
    skippedByLimit: 0,
    skippedByBudget: 1,
    transientUnknown: 1,
    removedConfirmed: 0,
    childRequests: 3,
  });
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

  await assert.rejects(availabilityPromise, { name: "AbortError" });

  assert.equal(validationAborted, true);
});
