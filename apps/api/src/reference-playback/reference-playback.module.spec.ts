import { FfprobeTorrentMediaProbe } from './media-probe';
import { WorkerTorrentMediaProbe } from './media-worker-client';
import { createConfiguredTorrentMediaProbe } from './reference-playback.module';
import type { TorrServerClientConfig } from './torrserver';

const CLIENT_CONFIG: TorrServerClientConfig = {
  baseUrl: new URL('http://torrserver.test/'),
  connectTimeoutMs: 1_000,
  requestTimeoutMs: 10_000,
  metadataTimeoutMs: 30_000,
  metadataPollIntervalMs: 250,
  maxConcurrency: 4,
  maxResponseBytes: 1_024,
  maxFiles: 100,
  maxPathLength: 1_024,
  maxFileSizeBytes: 10_000,
};

describe('reference playback media probe wiring', () => {
  it('selects exactly one explicit probe mode', () => {
    expect(
      createConfiguredTorrentMediaProbe(CLIENT_CONFIG, {}),
    ).toBeUndefined();
    expect(
      createConfiguredTorrentMediaProbe(CLIENT_CONFIG, {
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
          'http://torrent-media-worker:8080',
      }),
    ).toBeInstanceOf(WorkerTorrentMediaProbe);
    expect(
      createConfiguredTorrentMediaProbe(CLIENT_CONFIG, {
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: '/usr/bin/ffprobe',
      }),
    ).toBeInstanceOf(FfprobeTorrentMediaProbe);
  });

  it('rejects ambiguous mode and credential exposure', () => {
    expect(() =>
      createConfiguredTorrentMediaProbe(CLIENT_CONFIG, {
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
          'http://torrent-media-worker:8080',
        MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH: '/usr/bin/ffprobe',
      }),
    ).toThrow('not both');
    expect(() =>
      createConfiguredTorrentMediaProbe(
        { ...CLIENT_CONFIG, username: 'operator', password: 'secret' },
        {
          MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
            'http://torrent-media-worker:8080',
        },
      ),
    ).toThrow('cannot pass TorServer Basic Auth credentials');
  });

  it('does not activate probing while playback itself is disabled', () => {
    expect(
      createConfiguredTorrentMediaProbe(undefined, {
        MEDIA_ENGINE_TORRENT_PLAYBACK_MEDIA_WORKER_URL:
          'http://torrent-media-worker:8080',
      }),
    ).toBeUndefined();
  });
});
