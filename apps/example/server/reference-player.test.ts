import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  createReferencePlayerMiddleware,
  readReferencePlayerServerConfig,
} from "./reference-player.ts";

const TOKEN = "operator-token-that-is-at-least-32-characters";
const SESSION_ID = "s".repeat(43);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("reference player server boundary", () => {
  it("stays disabled without a server-only operator token", () => {
    assert.deepEqual(readReferencePlayerServerConfig({}), { enabled: false });
    assert.throws(
      () =>
        readReferencePlayerServerConfig({
          MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN: "short",
        }),
      /32-512/,
    );
  });

  it("reports only enabled state to the browser", async () => {
    const baseUrl = await startBoundary({
      enabled: true,
      apiUrl: new URL("http://api.test"),
      token: TOKEN,
    });
    const response = await fetch(`${baseUrl}/reference-player/config`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { enabled: true });
  });

  it("requires same-origin mutations and injects the operator token upstream", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImplementation = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json(
        {
          id: SESSION_ID,
          streamUrl: `/reference/torrent-playback/sessions/${SESSION_ID}/stream`,
          state: "ready",
        },
        { status: 201 },
      );
    }) as typeof fetch;
    const baseUrl = await startBoundary(
      { enabled: true, apiUrl: new URL("http://api.test/base/"), token: TOKEN },
      fetchImplementation,
    );
    const input = { provider: "test-torrent", candidateId: "candidate-1" };

    await fetch(`${baseUrl}/reference-player/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify(input),
    }).then((response) => assert.equal(response.status, 403));

    const response = await fetch(`${baseUrl}/reference-player/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify(input),
    });

    assert.equal(response.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://api.test/reference/torrent-playback/sessions");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), input);
    assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), `Bearer ${TOKEN}`);
    assert.doesNotMatch(await response.text(), /operator-token/);
  });

  it("allows only exact lifecycle session IDs and methods", async () => {
    const fetchImplementation = (async () =>
      Response.json({ id: SESSION_ID, state: "ready" })) as typeof fetch;
    const baseUrl = await startBoundary(
      { enabled: true, apiUrl: new URL("http://api.test"), token: TOKEN },
      fetchImplementation,
    );

    await fetch(`${baseUrl}/reference-player/sessions/short`).then((response) =>
      assert.equal(response.status, 404),
    );
    await fetch(`${baseUrl}/reference-player/sessions/${SESSION_ID}/stream`).then((response) =>
      assert.equal(response.status, 404),
    );
    await fetch(`${baseUrl}/reference-player/sessions/${SESSION_ID}?secret=x`).then((response) =>
      assert.equal(response.status, 404),
    );
  });

  it("rejects extra browser-controlled playback targets before upstream work", async () => {
    let upstreamCalls = 0;
    const fetchImplementation = (async () => {
      upstreamCalls += 1;
      return Response.json({});
    }) as typeof fetch;
    const baseUrl = await startBoundary(
      { enabled: true, apiUrl: new URL("http://api.test"), token: TOKEN },
      fetchImplementation,
    );
    const response = await fetch(`${baseUrl}/reference-player/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({
        provider: "test-torrent",
        candidateId: "candidate-1",
        magnet: "magnet:?xt=forbidden",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  });
});

async function startBoundary(
  config: Parameters<typeof createReferencePlayerMiddleware>[0],
  fetchImplementation?: typeof fetch,
): Promise<string> {
  const middleware = createReferencePlayerMiddleware(config, fetchImplementation);
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.writeHead(404).end();
    });
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
