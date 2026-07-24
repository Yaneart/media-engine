export const BITSEARCH_INFO_HASH = "ED0DA850C273E3E15A819BDCBBF418BC85107EC8";

export function createBitsearchTorrentPayload(query = "Dune 2021", perPage = 40) {
  return {
    success: true,
    query,
    results: [
      {
        id: "616c4e220985d20990b5512d",
        infohash: BITSEARCH_INFO_HASH,
        title: "Dune (2021) [2160p] [WEBRip] x265 EAC3 HDR10 MKV [YTS.MX]",
        size: 8_589_934_592,
        category: 2,
        subCategory: 2,
        seeders: 1_050,
        leechers: 372,
        downloads: 0,
        verified: true,
        createdAt: "2021-10-21T10:30:00.000Z",
        updatedAt: "2026-07-24T07:15:51.982Z",
      },
    ],
    pagination: {
      page: 1,
      perPage,
      total: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
    took: 3,
  };
}

export function createEmptyBitsearchTorrentPayload(query = "missing 2021", perPage = 40) {
  return {
    success: true,
    query,
    results: [],
    pagination: {
      page: 1,
      perPage,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
    took: 1,
  };
}
