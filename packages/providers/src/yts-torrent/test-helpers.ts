export function createYtsTorrentPayload() {
  return {
    status: "ok",
    status_message: "Query was successful",
    data: {
      movie_count: 1,
      movies: [
        {
          id: 1606,
          url: "https://yts.test/movies/inception-2010",
          imdb_code: "tt1375666",
          title: "Inception",
          title_english: "Inception",
          year: 2010,
          torrents: [
            {
              url: "https://yts.test/torrent/inception-720p",
              hash: "CE9156EB497762F8B7577B71C0647A4B0C3423E1",
              quality: "720p",
              type: "bluray",
              video_codec: "x264",
              seeds: 23,
              peers: 2,
              size_bytes: 1_148_903_752,
              date_uploaded_unix: 1_446_332_477,
            },
          ],
        },
      ],
    },
  };
}
