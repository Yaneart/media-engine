import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import {
  createOriginalTorrentBffMiddleware,
  readOriginalTorrentBffConfig,
  type OriginalTorrentBffConfig,
} from "./original-torrent-bff.ts";

const TOKEN = "test-original-torrent-token-123456";
const SESSION_ID = "A".repeat(32);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
});

test("BFF configuration is fail-closed and validates server-only values", () => {
  assert.deepEqual(readOriginalTorrentBffConfig({}), { enabled: false });
  assert.deepEqual(
    readOriginalTorrentBffConfig({
      MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL: "http://api.internal:3000",
      MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN: TOKEN,
    }),
    {
      enabled: true,
      apiUrl: new URL("http://api.internal:3000/"),
      token: TOKEN,
    },
  );
  assert.throws(
    () =>
      readOriginalTorrentBffConfig({
        MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL: "file:///private/api",
        MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN: TOKEN,
      }),
    /HTTP\(S\)/u,
  );
  assert.throws(
    () =>
      readOriginalTorrentBffConfig({
        MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN: "too-short",
      }),
    /MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN/u,
  );
});

test("BFF forwards exact create, status, selection, and stop routes with bearer auth", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const snapshot = {
    id: SESSION_ID,
    state: "adding",
    observation: { provider: "provider-a", id: "provider-a:opaque" },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-29T00:30:00.000Z",
  };
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    return Response.json(snapshot, {
      status: url.endsWith("/media/torrent-sessions") ? 202 : 200,
    });
  };
  const baseUrl = await startServer(fetchMock);
  const originHeaders = { origin: baseUrl };
  const createBody = {
    query: { type: "movie", title: "Dune", year: 2021 },
    observation: { provider: "provider-a", id: "provider-a:opaque" },
  };

  const config = await fetch(`${baseUrl}/torrent-player/config`);
  const configText = await config.text();
  assert.deepEqual(JSON.parse(configText), { enabled: true });
  assert.equal(configText.includes(TOKEN), false);

  const created = await fetch(`${baseUrl}/torrent-player/sessions`, {
    method: "POST",
    headers: { ...originHeaders, "content-type": "application/json" },
    body: JSON.stringify(createBody),
  });
  assert.equal(created.status, 202);
  assert.deepEqual(await created.json(), snapshot);

  assert.equal((await fetch(`${baseUrl}/torrent-player/sessions/${SESSION_ID}`)).status, 200);
  assert.equal(
    (
      await fetch(`${baseUrl}/torrent-player/sessions/${SESSION_ID}/selection`, {
        method: "POST",
        headers: { ...originHeaders, "content-type": "application/json" },
        body: JSON.stringify({ fileId: 7 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/torrent-player/sessions/${SESSION_ID}`, {
        method: "DELETE",
        headers: originHeaders,
      })
    ).status,
    204,
  );

  assert.deepEqual(
    calls.map((call) => [call.init?.method, call.url]),
    [
      ["POST", "http://api.internal:3000/media/torrent-sessions"],
      ["GET", `http://api.internal:3000/media/torrent-sessions/${SESSION_ID}`],
      ["POST", `http://api.internal:3000/media/torrent-sessions/${SESSION_ID}/selection`],
      ["DELETE", `http://api.internal:3000/media/torrent-sessions/${SESSION_ID}`],
    ],
  );
  for (const call of calls) {
    assert.equal(new Headers(call.init?.headers).get("authorization"), `Bearer ${TOKEN}`);
  }
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), createBody);
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { fileId: 7 });
});

test("BFF rejects cross-origin mutations, malformed routes, and oversized JSON", async () => {
  let upstreamCalls = 0;
  const baseUrl = await startServer(async () => {
    upstreamCalls += 1;
    return Response.json({});
  });

  const crossOrigin = await fetch(`${baseUrl}/torrent-player/sessions`, {
    method: "POST",
    headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);

  const malformed = await fetch(`${baseUrl}/torrent-player/sessions/not-valid`);
  assert.equal(malformed.status, 404);

  const queried = await fetch(`${baseUrl}/torrent-player/sessions/${SESSION_ID}?target=internal`);
  assert.equal(queried.status, 404);

  const oversized = await fetch(`${baseUrl}/torrent-player/sessions`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(20_000) }),
  });
  assert.equal(oversized.status, 400);
  assert.equal(upstreamCalls, 0);
});

test("BFF reports disabled and invalid upstream responses without leaking auth", async () => {
  const disabledUrl = await startServer(undefined, { enabled: false });
  const disabled = await fetch(`${disabledUrl}/torrent-player/sessions/${SESSION_ID}`);
  assert.equal(disabled.status, 503);

  const invalidUrl = await startServer(async () => new Response("not json", { status: 200 }));
  const invalid = await fetch(`${invalidUrl}/torrent-player/sessions/${SESSION_ID}`);
  assert.equal(invalid.status, 502);
  assert.equal((await invalid.text()).includes(TOKEN), false);
});

async function startServer(
  fetchImplementation: typeof fetch | undefined,
  config: OriginalTorrentBffConfig = {
    enabled: true,
    apiUrl: new URL("http://api.internal:3000/"),
    token: TOKEN,
  },
): Promise<string> {
  const middleware = createOriginalTorrentBffMiddleware(config, fetchImplementation ?? fetch);
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
