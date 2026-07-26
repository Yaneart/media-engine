import type { TorrentMediaRemuxConfig } from './media-remux-config';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FfmpegTorrentMediaRemuxExecutor,
  prepareTorrentMediaRemuxDirectory,
  type FfmpegExecutor,
} from './media-remux';

const CONFIG: TorrentMediaRemuxConfig = {
  executablePath: '/usr/bin/ffmpeg',
  outputDirectory: '/data/remux',
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
};
const INPUT = {
  target: {
    url: new URL(`http://torrserver.test/play/${'a'.repeat(40)}/7`),
    hash: 'a'.repeat(40),
    fileId: 7,
  },
  file: {
    id: 7,
    path: 'Movie.mkv',
    length: 900_000,
    compatibility: 'remux_required' as const,
  },
  container: 'mp4' as const,
  outputPath: '/data/remux/result.mp4',
};

describe('FFmpeg torrent media remux', () => {
  it('uses a no-shell stream-copy command with bounded output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-remux-test-'));
    const outputPath = join(directory, 'result.mp4');
    const execute = jest
      .fn<ReturnType<FfmpegExecutor>, Parameters<FfmpegExecutor>>()
      .mockImplementation(async () => {
        await writeFile(outputPath, new Uint8Array(800_000));
      });

    try {
      await expect(
        new FfmpegTorrentMediaRemuxExecutor(CONFIG, execute).remux({
          ...INPUT,
          outputPath,
        }),
      ).resolves.toEqual({
        path: outputPath,
        length: 800_000,
        container: 'mp4',
        contentType: 'video/mp4',
      });

      const [path, args, options] = execute.mock.calls[0];
      expect(path).toBe('/usr/bin/ffmpeg');
      expect(args).toEqual(
        expect.arrayContaining([
          '-nostdin',
          '-protocol_whitelist',
          'http,https,tcp,tls',
          '-max_redirects',
          '0',
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          '-fs',
          String(CONFIG.maxOutputBytes),
          '-movflags',
          '+faststart',
          outputPath,
        ]),
      );
      expect(options).toMatchObject({ timeoutMs: 120_000 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects oversized input before starting FFmpeg', async () => {
    const execute = jest.fn<
      ReturnType<FfmpegExecutor>,
      Parameters<FfmpegExecutor>
    >();
    await expect(
      new FfmpegTorrentMediaRemuxExecutor(CONFIG, execute).remux({
        ...INPUT,
        file: { ...INPUT.file, length: CONFIG.maxOutputBytes + 1 },
      }),
    ).rejects.toMatchObject({ code: 'output_limit' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps cancellation without exposing FFmpeg details', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new FfmpegTorrentMediaRemuxExecutor(CONFIG).remux({
        ...INPUT,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it.each([
    [Object.assign(new Error('private'), { code: 'ETIMEDOUT' }), 'timeout'],
    [Object.assign(new Error('private'), { code: 'ENOENT' }), 'unavailable'],
    [new DOMException('private', 'AbortError'), 'aborted'],
    [new Error('private'), 'failed'],
  ] as const)(
    'maps bounded subprocess failure %# safely',
    async (error, code) => {
      const execute = jest
        .fn<ReturnType<FfmpegExecutor>, Parameters<FfmpegExecutor>>()
        .mockRejectedValue(error);
      await expect(
        new FfmpegTorrentMediaRemuxExecutor(CONFIG, execute).remux(INPUT),
      ).rejects.toMatchObject({ code });
    },
  );

  it('uses the default no-shell executor without exposing spawn details', async () => {
    await expect(
      new FfmpegTorrentMediaRemuxExecutor({
        ...CONFIG,
        executablePath: '/definitely-missing-media-engine-ffmpeg',
      }).remux(INPUT),
    ).rejects.toMatchObject({ code: 'failed' });
  });

  it('removes only recognized orphan outputs from its dedicated directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-remux-cleanup-'));
    const orphan = join(directory, `${'a'.repeat(43)}.mp4`);
    const unrelated = join(directory, 'keep.txt');
    await writeFile(orphan, 'orphan');
    await writeFile(unrelated, 'keep');

    try {
      await prepareTorrentMediaRemuxDirectory(directory);
      await expect(access(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(unrelated)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
