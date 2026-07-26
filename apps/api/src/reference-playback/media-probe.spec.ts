import type { TorrentPlaybackMediaProbeConfig } from './media-probe-config';
import {
  FfprobeTorrentMediaProbe,
  parseFfprobeOutput,
  type FfprobeExecutor,
} from './media-probe';

const CONFIG: TorrentPlaybackMediaProbeConfig = {
  executablePath: '/usr/bin/ffprobe',
  timeoutMs: 20_000,
  maxOutputBytes: 65_536,
  probeSizeBytes: 8_388_608,
  analyzeDurationUs: 5_000_000,
};
const TARGET = {
  url: new URL(`http://torrserver.test/play/${'a'.repeat(40)}/7`),
  hash: 'a'.repeat(40),
  fileId: 7,
};
const FILE = {
  id: 7,
  path: 'Movie.mp4',
  length: 1_000_000,
  compatibility: 'direct' as const,
};

describe('ffprobe torrent media probe', () => {
  it('runs an exact bounded no-shell command and parses primary streams', async () => {
    const execute = jest
      .fn<ReturnType<FfprobeExecutor>, Parameters<FfprobeExecutor>>()
      .mockResolvedValue({ stdout: validOutput(), stderr: '' });
    const probe = new FfprobeTorrentMediaProbe(CONFIG, execute);

    await expect(probe.probe({ target: TARGET, file: FILE })).resolves.toEqual({
      formatNames: ['mov', 'mp4'],
      video: {
        codecName: 'h264',
        profile: 'High',
        pixelFormat: 'yuv420p',
        width: 1920,
        height: 1080,
      },
      audio: { codecName: 'aac', profile: 'LC' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [path, args, options] = execute.mock.calls[0];
    expect(path).toBe('/usr/bin/ffprobe');
    expect(args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-cpucount',
      '1',
      '-max_alloc',
      '67108864',
      '-protocol_whitelist',
      'http,https,tcp,tls',
      '-max_redirects',
      '0',
      '-rw_timeout',
      '20000000',
      '-analyzeduration',
      '5000000',
      '-probesize',
      '8388608',
      '-show_entries',
      'format=format_name:stream=codec_type,codec_name,profile,pix_fmt,width,height:stream_disposition=default,attached_pic',
      '-of',
      'json',
      TARGET.url.href,
    ]);
    expect(options).toEqual({
      signal: undefined,
      timeoutMs: 20_000,
      maxOutputBytes: 65_536,
    });
  });

  it.each([
    [{ killed: true, signal: 'SIGKILL' }, 'timeout'],
    [{ code: 'ENOENT' }, 'unavailable'],
    [
      {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        killed: true,
        signal: 'SIGKILL',
      },
      'invalid_response',
    ],
    [new Error('ffprobe rejected the file'), 'invalid_response'],
  ] as const)('maps execution failure %# safely', async (failure, code) => {
    const execute = jest
      .fn<ReturnType<FfprobeExecutor>, Parameters<FfprobeExecutor>>()
      .mockRejectedValue(failure);

    await expect(
      new FfprobeTorrentMediaProbe(CONFIG, execute).probe({
        target: TARGET,
        file: FILE,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects pre-aborted work and credential-bearing targets before execution', async () => {
    const execute = jest.fn<
      ReturnType<FfprobeExecutor>,
      Parameters<FfprobeExecutor>
    >();
    const probe = new FfprobeTorrentMediaProbe(CONFIG, execute);
    const controller = new AbortController();
    controller.abort();

    await expect(
      probe.probe({ target: TARGET, file: FILE, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    await expect(
      probe.probe({
        target: {
          ...TARGET,
          url: new URL('http://user:secret@host.test/play'),
        },
        file: FILE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      probe.probe({
        target: { ...TARGET, url: new URL('file:///tmp/media.mp4') },
        file: FILE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ffprobe output parsing', () => {
  it('ignores attached artwork and selects default video/audio streams', () => {
    const parsed = JSON.parse(validOutput()) as { streams: unknown[] };
    parsed.streams.unshift({
      codec_type: 'video',
      codec_name: 'mjpeg',
      pix_fmt: 'yuvj420p',
      width: 600,
      height: 900,
      disposition: { attached_pic: 1 },
    });

    expect(parseFfprobeOutput(JSON.stringify(parsed))).toMatchObject({
      video: { codecName: 'h264' },
      audio: { codecName: 'aac' },
    });
  });

  it.each([
    '',
    'not json',
    '{}',
    JSON.stringify({ format: { format_name: 'mov,mp4' }, streams: [] }),
    JSON.stringify({
      format: { format_name: 'mov,mp4' },
      streams: [{ codec_type: 'audio', codec_name: 'aac' }],
    }),
    JSON.stringify({
      format: { format_name: '../unsafe' },
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
    }),
  ])('rejects invalid bounded output %#', (value) => {
    expect(() => parseFfprobeOutput(value)).toThrow(
      'Media inspection did not return valid bounded metadata.',
    );
  });
});

function validOutput(): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        pix_fmt: 'yuv420p',
        width: 1920,
        height: 1080,
        disposition: { default: 1, attached_pic: 0 },
      },
      {
        codec_type: 'audio',
        codec_name: 'aac',
        profile: 'LC',
        disposition: { default: 1, attached_pic: 0 },
      },
      { codec_type: 'subtitle', codec_name: 'subrip' },
    ],
    format: { format_name: 'mov,mp4' },
  });
}
