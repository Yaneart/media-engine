import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderError } from "@media-engine/core";
import { createVeoVeoConfig } from "./config.js";
import { lookupVeoVeoContentId } from "./lookup.js";

test("VeoVeo looks up IMDb directly and verifies identity without forwarding its token", async () => {
  const urls: URL[] = [];
  const config = createVeoVeoConfig({
    apiKey: "owned-secret",
    fetch: async (input) => {
      const url = new URL(input);
      urls.push(url);
      return urls.length === 1
        ? new Response("window.MOVIE_ID=21797;")
        : Response.json({ id: 21797, imdbId: "tt0816692", kinopoiskId: 258687 });
    },
  });
  const result = await lookupVeoVeoContentId(config, { source: "imdb", id: "tt0816692" }, {});
  assert.equal(urls[0]?.hostname, "api.rstprgapipt.com");
  assert.equal(urls[0]?.searchParams.get("imdb"), "tt0816692");
  assert.equal(urls[0]?.searchParams.get("token"), "owned-secret");
  assert.equal(urls[1]?.searchParams.has("token"), false);
  assert.equal(result?.contentId, "21797");
  assert.equal(result?.sourceUrl, "https://api.rstprgapipt.com/balancer-api/iframe?imdb=tt0816692");
  assert.equal(JSON.stringify(result).includes("owned-secret"), false);
});

test("VeoVeo rejects missing tokens before making a request", async () => {
  const config = createVeoVeoConfig({
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(
    lookupVeoVeoContentId(config, { source: "kinopoisk", id: "2000102" }, {}),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_UNAUTHORIZED",
  );
});

test("VeoVeo rejects absent, conflicting, or malformed identity before loading episodes", async () => {
  for (const details of [
    null,
    [],
    {},
    { id: 999, kinopoiskId: 2000102 },
    { id: 2234, kinopoiskId: 999 },
    { id: 2234, imdbId: "tt12590266" },
  ]) {
    let calls = 0;
    const config = createVeoVeoConfig({
      apiKey: "owned-secret",
      fetch: async () => {
        calls += 1;
        return calls === 1 ? new Response("window.MOVIE_ID=2234;") : Response.json(details);
      },
    });
    assert.equal(
      await lookupVeoVeoContentId(config, { source: "kinopoisk", id: "2000102" }, {}),
      null,
    );
    assert.equal(calls, 2);
  }
});

test("VeoVeo handles a missing title and redacts HTTP, transport, and oversized lookup errors", async () => {
  for (const mode of ["empty", "http", "transport", "oversized"]) {
    let calls = 0;
    const config = createVeoVeoConfig({
      apiKey: "owned-secret",
      maxLookupResponseBytes: 1024,
      fetch: async (input) => {
        calls += 1;
        if (mode === "transport") throw new Error(`fetch failed: ${input}`);
        if (mode === "http") return new Response(null, { status: 403 });
        return new Response(mode === "empty" ? "<html></html>" : "x".repeat(1025));
      },
    });
    const pending = lookupVeoVeoContentId(config, { source: "kinopoisk", id: "2000102" }, {});
    if (mode === "empty") assert.equal(await pending, null);
    else
      await assert.rejects(
        pending,
        (error) =>
          error instanceof ProviderError &&
          !String(error.stack).includes("owned-secret") &&
          error.cause === undefined &&
          (mode !== "http" || error.code === "PROVIDER_UNAUTHORIZED"),
      );
    assert.equal(calls, 1);
  }
});

test("VeoVeo bounds stalled lookup bodies and preserves cancellation during identity verification", async (t) => {
  // Unlike a real HTTP socket, this mock stream has no referenced I/O handle.
  // AbortSignal.timeout() alone does not keep Node 20's event loop alive.
  const keepAlive = setTimeout(() => {}, 1_000);
  t.after(() => clearTimeout(keepAlive));
  const stalled = createVeoVeoConfig({
    apiKey: "owned-secret",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("window."));
          },
        }),
      ),
  });
  await assert.rejects(
    lookupVeoVeoContentId(stalled, { source: "kinopoisk", id: "2000102" }, { timeoutMs: 25 }),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_TIMEOUT",
  );
  const controller = new AbortController();
  const cancellation = new Error("caller cancelled");
  const config = createVeoVeoConfig({
    apiKey: "owned-secret",
    fetch: async (input) => {
      if (new URL(input).pathname.endsWith("/iframe")) return new Response("window.MOVIE_ID=2234;");
      controller.abort(cancellation);
      throw cancellation;
    },
  });
  await assert.rejects(
    lookupVeoVeoContentId(
      config,
      { source: "kinopoisk", id: "2000102" },
      { signal: controller.signal },
    ),
    (error) => error === cancellation,
  );
});
