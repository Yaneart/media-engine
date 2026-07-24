export const MAGNETZ_INFO_HASH = "9B14E6BD490E2E0C1A8D4DB45A31A2BFF92C421D";

export function createMagnetzTorrentPayload(query = "Inception 2010") {
  return {
    data: [
      {
        sqid: "xRTTwe",
        name: "Inception 2010 REPACK 1080p BluRay x265 EAC3 MKV HDR10-YAWNTiC",
        info_hash: MAGNETZ_INFO_HASH,
        size: 8_158_598_962,
        human_size: "7.6 GB",
        score: 64,
        health: 2,
        is_verified: true,
        largest_file: "Inception/Inception.2010.1080p.BluRay.x265.mkv",
        magnet_link: `magnet:?xt=urn:btih:${MAGNETZ_INFO_HASH}&dn=Inception%202010`,
        seeders: 26,
        leechers: 12,
        created_at: "2026-06-28T20:51:14+00:00",
        web_url: "https://magnetz.test/xRTTwe",
      },
    ],
    links: {
      first: `https://magnetz.test/api/magnets/search?query=${encodeURIComponent(query)}&page=1`,
      last: `https://magnetz.test/api/magnets/search?query=${encodeURIComponent(query)}&page=1`,
      prev: null,
      next: null,
    },
    meta: {
      query,
      current_page: 1,
      last_page: 1,
      per_page: 25,
      total: 1,
      from: 1,
      to: 1,
    },
  };
}

export function createEmptyMagnetzTorrentPayload(query = "missing 2021") {
  return {
    data: [],
    links: {
      first: `https://magnetz.test/api/magnets/search?query=${encodeURIComponent(query)}&page=1`,
      last: `https://magnetz.test/api/magnets/search?query=${encodeURIComponent(query)}&page=1`,
      prev: null,
      next: null,
    },
    meta: {
      query,
      current_page: 1,
      last_page: 1,
      per_page: 25,
      total: 0,
      from: null,
      to: null,
    },
  };
}
