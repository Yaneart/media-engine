import assert from "node:assert/strict";
import test from "node:test";
import type { MediaDetails, TorrentCandidate } from "../api";
import {
  buildTorrentDiscoveryQuery,
  formatBytes,
  formatTorrentCandidateMeta,
  formatTorrentPeers,
  mapNativeMediaFailure,
} from "./model.ts";

const details = {
  type: "series",
  title: "Игра престолов",
  originalTitle: "Game of Thrones",
  year: 2011,
  ids: { imdb: "tt0944947" },
} as MediaDetails;

const candidate = {
  id: "provider-a:opaque",
  provider: "provider-a",
  title: "Exact release",
  sizeBytes: 2 * 1_024 ** 3,
  release: {
    resolution: "1080p",
    source: "bluray",
    videoCodec: "h264",
    audioCodec: "aac",
  },
  peers: { seeders: 12, leechers: 3 },
  handoff: { kind: "magnet", uri: "magnet:?hidden" },
  availability: "available",
} as TorrentCandidate;

test("torrent discovery query preserves exact media and episode identity", () => {
  assert.deepEqual(
    buildTorrentDiscoveryQuery(details, "ru", { seasonNumber: 2, episodeNumber: 4 }),
    {
      type: "series",
      title: "Game of Thrones",
      year: 2011,
      ids: { imdb: "tt0944947" },
      language: "ru",
      limit: 25,
      seasonNumber: 2,
      episodeNumber: 4,
    },
  );
});

test("release presentation preserves provider metadata and peer observations", () => {
  assert.equal(
    formatTorrentCandidateMeta(candidate),
    "provider-a · 1080p · bluray · h264 · aac · 2.00 GiB",
  );
  assert.equal(formatTorrentPeers(candidate), "12 seeders · 3 leechers");
  assert.equal(formatTorrentPeers({ ...candidate, peers: undefined }), "Peer availability unknown");
  assert.equal(formatBytes(0), "0 B");
});

test("native decode rejection is distinct from known server stream failures", () => {
  assert.deepEqual(mapNativeMediaFailure(4), {
    code: "client_format_unsupported",
    message:
      "The original file is available, but this browser cannot decode its container or codecs.",
    transient: false,
  });
  assert.deepEqual(
    mapNativeMediaFailure(2, {
      id: "A".repeat(32),
      state: "failed",
      observation: { provider: "provider-a", id: "provider-a:opaque" },
      error: {
        code: "torrent_pieces_unavailable",
        message: "Required pieces did not arrive.",
        transient: true,
      },
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:01.000Z",
      expiresAt: "2026-07-29T00:30:00.000Z",
    }),
    {
      code: "torrent_pieces_unavailable",
      message: "Required pieces did not arrive.",
      transient: true,
    },
  );
});
