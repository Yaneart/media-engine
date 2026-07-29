import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resolveOriginalTorrentStreamUrl,
  stopOriginalTorrentSession,
  toOriginalTorrentSessionQuery,
} from "./originalTorrent.ts";

const SESSION_ID = "A".repeat(32);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("session creation query strips discovery-only provider fanout controls", () => {
  assert.deepEqual(
    toOriginalTorrentSessionQuery({
      type: "movie",
      title: "Dune",
      year: 2021,
      providers: ["provider-a"],
      limit: 25,
    }),
    { type: "movie", title: "Dune", year: 2021 },
  );
});

test("stream URL accepts only the API capability path", () => {
  assert.equal(
    resolveOriginalTorrentStreamUrl(`/media/torrent-streams/${"B".repeat(43)}`),
    `http://127.0.0.1:3000/media/torrent-streams/${"B".repeat(43)}`,
  );
  assert.throws(
    () => resolveOriginalTorrentStreamUrl("http://torrserver:8090/play/hash/1"),
    /invalid torrent stream capability/u,
  );
});

test("page-close cleanup can send the exact stop route with keepalive", async () => {
  let input: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  globalThis.fetch = async (nextInput, nextInit) => {
    input = nextInput;
    init = nextInit;
    return new Response(null, { status: 204 });
  };

  await stopOriginalTorrentSession(SESSION_ID, { keepalive: true });

  assert.equal(String(input), `/torrent-player/sessions/${SESSION_ID}`);
  assert.equal(init?.method, "DELETE");
  assert.equal(init?.keepalive, true);
});
