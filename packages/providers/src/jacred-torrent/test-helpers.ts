export const JACRED_INFO_HASH = "A5119830B7F6289F3AD985E3DDA0AB2F161305B5";

export function createJacRedTorrentPayload() {
  return {
    query: "Дюна",
    source: "http://jacred:9117",
    total: 1,
    loaded: 1,
    limit: 40,
    open: true,
    facets: {},
    results: [
      {
        id: "release-1",
        title: "Дюна / Dune: Part One (2021) UHD BDRip-HEVC 2160p MKV | HDR10 | Дубляж",
        tracker: "rutracker",
        size: 44_452_911_513,
        size_name: "41.4 GB",
        created_at: "2021-10-25",
        updated_at: "2026-07-20",
        seeders: 296,
        peers: 13,
        name: "Дюна",
        original_name: "Dune: Part One",
        year: 2021,
        video_type: "hdr",
        quality: 2160,
        quality_label: "4K",
        voices: ["Дубляж"],
        seasons: [],
        categories: ["movie"],
        magnet_available: true,
        availability_score: 0.95,
        magnet: `magnet:?xt=urn:btih:${JACRED_INFO_HASH}&tr=http%3A%2F%2Ftracker.test%2Fannounce`,
        source_url: "https://rutracker.org/forum/viewtopic.php?t=6124572",
      },
    ],
  };
}
