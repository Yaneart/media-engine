import { readOriginalTorrentRuntimeConfig } from './runtime.config';
import {
  normalizeFileId,
  normalizeOriginalTorrentSource,
  parseTorrentStatus,
  parseUploadedTorrent,
} from './runtime.parsing';

const HASH = 'a'.repeat(40);
const config = readOriginalTorrentRuntimeConfig({
  MEDIA_ENGINE_TORRSERVER_URL: 'http://torrserver:8090',
})!;

describe('original torrent runtime parsing', () => {
  it('accepts a hash-bound magnet and isolates torrent bytes', () => {
    const magnet = normalizeOriginalTorrentSource(
      {
        kind: 'magnet',
        uri: `magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=Fixture`,
        expectedHash: HASH.toUpperCase(),
        title: ' Fixture ',
      },
      config,
    );
    expect(magnet).toEqual({
      kind: 'magnet',
      uri: `magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=Fixture`,
      expectedHash: HASH,
      title: 'Fixture',
    });

    const bytes = new Uint8Array([1, 2, 3]);
    const file = normalizeOriginalTorrentSource(
      { kind: 'torrent_file', bytes, expectedHash: HASH },
      config,
    );
    bytes[0] = 9;
    expect(file.kind === 'torrent_file' && file.bytes[0]).toBe(1);
  });

  it.each([
    [`magnet:?xt=urn:btih:${'b'.repeat(40)}`, /does not match/],
    ['magnet:?dn=missing-hash', /does not match/],
    [`magnet:?xt=urn:btih:${HASH}&xt=urn:btih:${HASH}`, /does not match/],
    ['https://example.com/file.torrent', /valid bounded magnet/],
  ])('rejects invalid magnet %s', (uri, message) => {
    expect(() =>
      normalizeOriginalTorrentSource(
        { kind: 'magnet', uri, expectedHash: HASH },
        config,
      ),
    ).toThrow(message);
  });

  it('rejects invalid hashes, titles, file IDs, and torrent byte bounds', () => {
    expect(() =>
      normalizeOriginalTorrentSource(
        { kind: 'torrent_file', bytes: new Uint8Array(), expectedHash: HASH },
        config,
      ),
    ).toThrow(/empty or exceeds/);
    expect(() =>
      normalizeOriginalTorrentSource(
        {
          kind: 'torrent_file',
          bytes: new Uint8Array(config.maxTorrentBytes + 1),
          expectedHash: HASH,
        },
        config,
      ),
    ).toThrow(/empty or exceeds/);
    expect(() =>
      normalizeOriginalTorrentSource(
        {
          kind: 'magnet',
          uri: `magnet:?xt=urn:btih:${HASH}`,
          expectedHash: 'bad',
        },
        config,
      ),
    ).toThrow(/40 hexadecimal/);
    expect(() => normalizeFileId(0)).toThrow(/outside the accepted range/);
  });

  it('parses exact bounded file metadata', () => {
    expect(
      parseTorrentStatus(
        {
          hash: HASH.toUpperCase(),
          stat: 3,
          stat_string: 'Torrent working',
          name: 'Fixture',
          loaded_size: 5,
          torrent_size: 7,
          file_stats: [{ id: 1, path: 'video/movie.mkv', length: 7 }],
        },
        config,
      ),
    ).toEqual({
      hash: HASH,
      state: 3,
      stateLabel: 'Torrent working',
      name: 'Fixture',
      loadedSize: 5,
      torrentSize: 7,
      files: [{ id: 1, path: 'video/movie.mkv', length: 7 }],
    });
  });

  it.each([
    [
      { hash: 'bad', stat: 0, stat_string: 'Added' },
      /invalid torrent identity/,
    ],
    [{ hash: HASH, stat: 9, stat_string: 'Bad' }, /invalid state/],
    [{ hash: HASH, stat: 0, stat_string: '' }, /invalid state label/],
    [
      {
        hash: HASH,
        stat: 0,
        stat_string: 'Added',
        file_stats: [{ id: 1, path: '../escape', length: 1 }],
      },
      /unsafe file path/,
    ],
    [
      {
        hash: HASH,
        stat: 0,
        stat_string: 'Added',
        file_stats: [
          { id: 1, path: 'a', length: 1 },
          { id: 1, path: 'b', length: 1 },
        ],
      },
      /duplicate file IDs/,
    ],
    [
      {
        hash: HASH,
        stat: 0,
        stat_string: 'Added',
        torrent_size: 1,
        file_stats: [{ id: 1, path: 'a', length: 2 }],
      },
      /inconsistent torrent sizes/,
    ],
  ])('rejects malformed TorrServer status %#', (value, message) => {
    expect(() => parseTorrentStatus(value, config)).toThrow(message);
  });

  it('requires exactly one uploaded result with the expected identity', () => {
    const status = {
      hash: HASH,
      stat: 0,
      stat_string: 'Torrent added',
    };
    expect(parseUploadedTorrent([status], HASH, config).hash).toBe(HASH);
    expect(() => parseUploadedTorrent([], HASH, config)).toThrow(/exactly one/);
    expect(() =>
      parseUploadedTorrent([status], 'b'.repeat(40), config),
    ).toThrow(/different torrent identity/);
  });
});
