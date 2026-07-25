import { classifyTorrentFile, selectTorrentFile } from './file-selection';
import { torrentCandidate } from './test-helpers';

describe('torrent file selection', () => {
  it('automatically selects one unambiguous movie video and ignores samples', () => {
    const candidate = torrentCandidate();
    const result = selectTorrentFile(
      [
        { id: 1, path: 'Example.Movie.2026.mp4', length: 1_000_000 },
        { id: 2, path: 'Sample/sample.mkv', length: 10_000 },
        { id: 3, path: 'cover.jpg', length: 1_000 },
      ],
      candidate,
      { type: 'movie', title: 'Example Movie', year: 2026 },
      undefined,
      10,
    );

    expect(result.selected).toEqual({
      id: 1,
      path: 'Example.Movie.2026.mp4',
      length: 1_000_000,
      compatibility: 'direct',
    });
    expect(result.offeredFiles).toHaveLength(2);
  });

  it('selects exact ordinary and absolute episode paths conservatively', () => {
    const files = [
      { id: 1, path: 'Show.S01E01.mkv', length: 100_000 },
      { id: 2, path: 'Show.S1E2.mkv', length: 100_000 },
      { id: 3, path: 'Anime - 003.mp4', length: 100_000 },
    ];

    expect(
      selectTorrentFile(
        files,
        torrentCandidate(),
        { type: 'series', seasonNumber: 1, episodeNumber: 2 },
        undefined,
        10,
      ).selected?.id,
    ).toBe(2);
    expect(
      selectTorrentFile(
        files,
        torrentCandidate(),
        { type: 'anime', absoluteEpisodeNumber: 3 },
        undefined,
        10,
      ).selected?.id,
    ).toBe(3);
  });

  it('uses exact candidate episode metadata only for a single video', () => {
    const result = selectTorrentFile(
      [{ id: 7, path: 'opaque-name.webm', length: 500_000 }],
      torrentCandidate({ episode: { seasonNumber: 2, episodeNumber: 4 } }),
      { type: 'series', seasonNumber: 2, episodeNumber: 4 },
      undefined,
      10,
    );

    expect(result.selected?.id).toBe(7);
  });

  it('requires selection for ambiguous files and bounds the offered list', () => {
    const result = selectTorrentFile(
      [
        { id: 1, path: 'Movie.1080p.mkv', length: 2_000 },
        { id: 2, path: 'Movie.2160p.mkv', length: 4_000 },
        { id: 3, path: 'Movie.720p.mp4', length: 1_000 },
      ],
      torrentCandidate(),
      { type: 'movie' },
      undefined,
      2,
    );

    expect(result.selected).toBeUndefined();
    expect(result.offeredFiles.map((file) => file.id)).toEqual([2, 1]);
  });

  it('accepts only a server-offered video file ID', () => {
    const files = [
      { id: 1, path: 'Movie.mkv', length: 2_000 },
      { id: 2, path: 'subtitle.srt', length: 100 },
    ];

    expect(
      selectTorrentFile(files, torrentCandidate(), { type: 'movie' }, 1, 10)
        .selected?.id,
    ).toBe(1);
    expect(
      selectTorrentFile(files, torrentCandidate(), { type: 'movie' }, 2, 10)
        .selected,
    ).toBeUndefined();
  });

  it.each([
    ['movie.mp4', {}, 'direct'],
    ['movie.mkv', {}, 'remux_required'],
    ['movie.avi', { videoCodec: 'XviD' }, 'transcode_required'],
    ['movie.mp4', { audioCodec: 'DTS-HD' }, 'transcode_required'],
    ['movie.bin', {}, 'unknown'],
  ] as const)(
    'classifies %s without claiming browser support',
    (path, release, expected) => {
      expect(classifyTorrentFile(path, torrentCandidate({ release }))).toBe(
        expected,
      );
    },
  );
});
