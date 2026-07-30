import assert from "node:assert/strict";
import test from "node:test";
import type { MediaDetails, TorrentCandidate, TorrentProviderInfo } from "../api";
import {
  buildTorrentDiscoveryQuery,
  formatBytes,
  formatTorrentCandidateMeta,
  formatTorrentCandidateSource,
  formatTorrentPeers,
  groupTorrentCandidates,
  mapNativeMediaFailure,
  shouldIgnoreNativeMediaError,
} from "./model.ts";

const details = {
  type: "series",
  title: "Игра престолов",
  originalTitle: "Game of Thrones",
  alternativeTitles: ["A Game of Thrones", "Game of Thrones"],
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

test("torrent discovery query preserves media aliases and optional episode identity", () => {
  assert.deepEqual(
    buildTorrentDiscoveryQuery(details, "ru", { seasonNumber: 2, episodeNumber: 4 }),
    {
      type: "series",
      title: "Game of Thrones",
      alternativeTitles: ["Игра престолов", "A Game of Thrones"],
      year: 2011,
      ids: { imdb: "tt0944947" },
      language: "ru",
      limit: 25,
      seasonNumber: 2,
      episodeNumber: 4,
    },
  );

  assert.deepEqual(buildTorrentDiscoveryQuery(details, "ru"), {
    type: "series",
    title: "Game of Thrones",
    alternativeTitles: ["Игра престолов", "A Game of Thrones"],
    year: 2011,
    ids: { imdb: "tt0944947" },
    language: "ru",
    limit: 25,
  });
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

test("torrent candidates group by provider catalog without inventing release language", () => {
  const jacredCandidate = {
    ...candidate,
    id: "jacred-torrent:release",
    provider: "jacred-torrent",
    catalogSource: { id: "rutracker", displayName: "RuTracker" },
  } satisfies TorrentCandidate;
  const ytsCandidate = {
    ...candidate,
    id: "yts-torrent:release",
    provider: "yts-torrent",
  } satisfies TorrentCandidate;
  const customCandidate = {
    ...candidate,
    id: "custom:release",
    provider: "custom",
  } satisfies TorrentCandidate;
  const providers: TorrentProviderInfo[] = [
    {
      name: "jacred-torrent",
      kind: "torrent",
      catalog: { displayName: "JacRed", scope: "regional", locale: "ru" },
      capabilities: {
        mediaTypes: ["movie"],
        lookup: { byTitle: true, byExternalIds: [], byEpisode: false },
      },
    },
    {
      name: "yts-torrent",
      kind: "torrent",
      catalog: { displayName: "YTS", scope: "international" },
      capabilities: {
        mediaTypes: ["movie"],
        lookup: { byTitle: true, byExternalIds: [], byEpisode: false },
      },
    },
  ];

  assert.deepEqual(
    groupTorrentCandidates([ytsCandidate, customCandidate, jacredCandidate], providers).map(
      (group) => ({
        key: group.key,
        label: group.label,
        providers: group.providers.map((provider) => [
          provider.provider,
          provider.displayName,
          provider.candidates.map((entry) => entry.id),
        ]),
      }),
    ),
    [
      {
        key: "russian",
        label: "Russian-language catalogs",
        providers: [["jacred-torrent", "JacRed", ["jacred-torrent:release"]]],
      },
      {
        key: "international",
        label: "International catalogs",
        providers: [["yts-torrent", "YTS", ["yts-torrent:release"]]],
      },
      {
        key: "other",
        label: "Other catalogs",
        providers: [["custom", "custom", ["custom:release"]]],
      },
    ],
  );
  assert.equal(formatTorrentCandidateMeta(jacredCandidate).startsWith("RuTracker ·"), true);
  assert.equal(formatTorrentCandidateSource(jacredCandidate, providers[0]), "JacRed · RuTracker");
  assert.equal(jacredCandidate.release?.audioLanguages, undefined);
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

test("native media errors from an explicit stop or replaced session are ignored", () => {
  assert.equal(shouldIgnoreNativeMediaError("session-a", "session-a", undefined), false);
  assert.equal(shouldIgnoreNativeMediaError("session-a", "session-a", "session-a"), true);
  assert.equal(shouldIgnoreNativeMediaError("session-a", "session-b", undefined), true);
  assert.equal(shouldIgnoreNativeMediaError(undefined, undefined, undefined), true);
});
