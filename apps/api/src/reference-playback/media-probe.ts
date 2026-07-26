import { execFile } from 'node:child_process';
import type { TorrentPlaybackMediaProbeConfig } from './media-probe-config';
import type { TorrServerPlayTarget } from './torrserver';
import { hasControlCharacters } from './torrserver/validation';
import type { TorrentPlaybackFile } from './types';

const MAX_STREAMS = 64;
const MAX_FORMAT_NAMES = 16;
const MAX_CODEC_NAME_LENGTH = 64;
const MAX_PROFILE_LENGTH = 128;
const MAX_PIXEL_FORMAT_LENGTH = 64;
const MAX_DIMENSION = 65_535;
const MAX_ALLOC_BYTES = 64 * 1024 * 1024;

export type TorrentMediaProbeErrorCode =
  'aborted' | 'timeout' | 'unavailable' | 'invalid_response';

export class TorrentMediaProbeError extends Error {
  override readonly name = 'TorrentMediaProbeError';

  constructor(
    readonly code: TorrentMediaProbeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TorrentMediaProbeVideoStream {
  codecName: string;
  profile?: string;
  pixelFormat?: string;
  width?: number;
  height?: number;
}

export interface TorrentMediaProbeAudioStream {
  codecName: string;
  profile?: string;
}

export interface TorrentMediaProbeResult {
  formatNames: string[];
  video: TorrentMediaProbeVideoStream;
  audio?: TorrentMediaProbeAudioStream;
}

export interface TorrentMediaProbeInput {
  target: TorrServerPlayTarget;
  file: TorrentPlaybackFile;
  signal?: AbortSignal;
}

export interface TorrentMediaProbe {
  probe(input: TorrentMediaProbeInput): Promise<TorrentMediaProbeResult>;
}

interface FfprobeExecutionOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}

interface FfprobeExecutionResult {
  stdout: string;
  stderr: string;
}

export type FfprobeExecutor = (
  executablePath: string,
  args: string[],
  options: FfprobeExecutionOptions,
) => Promise<FfprobeExecutionResult>;

export class FfprobeTorrentMediaProbe implements TorrentMediaProbe {
  constructor(
    private readonly config: TorrentPlaybackMediaProbeConfig,
    private readonly execute: FfprobeExecutor = executeFfprobe,
  ) {}

  async probe(input: TorrentMediaProbeInput): Promise<TorrentMediaProbeResult> {
    if (input.signal?.aborted) {
      throw probeError('aborted');
    }

    if (
      (input.target.url.protocol !== 'http:' &&
        input.target.url.protocol !== 'https:') ||
      input.target.url.username.length > 0 ||
      input.target.url.password.length > 0
    ) {
      throw probeError('invalid_response');
    }

    try {
      const result = await this.execute(
        this.config.executablePath,
        createFfprobeArgs(input.target.url, this.config),
        {
          signal: input.signal,
          timeoutMs: this.config.timeoutMs,
          maxOutputBytes: this.config.maxOutputBytes,
        },
      );
      return parseFfprobeOutput(result.stdout);
    } catch (error) {
      if (error instanceof TorrentMediaProbeError) {
        throw error;
      }

      if (input.signal?.aborted || isAbortError(error)) {
        throw probeError('aborted');
      }

      if (isTimeoutError(error)) {
        throw probeError('timeout');
      }

      if (isUnavailableError(error)) {
        throw probeError('unavailable');
      }

      throw probeError('invalid_response');
    }
  }
}

export function isTorrentMediaProbeError(
  error: unknown,
): error is TorrentMediaProbeError {
  return error instanceof TorrentMediaProbeError;
}

export function parseFfprobeOutput(value: string): TorrentMediaProbeResult {
  if (value.length === 0 || value.length > 64 * 1024) {
    throw probeError('invalid_response');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw probeError('invalid_response');
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.streams)) {
    throw probeError('invalid_response');
  }

  if (parsed.streams.length === 0 || parsed.streams.length > MAX_STREAMS) {
    throw probeError('invalid_response');
  }

  const streams = parsed.streams.map(parseStream);
  const video = selectPrimaryStream(streams, 'video');

  if (video === undefined || video.attachedPicture) {
    throw probeError('invalid_response');
  }

  const audio = selectPrimaryStream(streams, 'audio');
  const formatNames = parseFormatNames(parsed.format);

  return {
    formatNames,
    video: {
      codecName: video.codecName,
      ...(video.profile === undefined ? {} : { profile: video.profile }),
      ...(video.pixelFormat === undefined
        ? {}
        : { pixelFormat: video.pixelFormat }),
      ...(video.width === undefined ? {} : { width: video.width }),
      ...(video.height === undefined ? {} : { height: video.height }),
    },
    ...(audio === undefined
      ? {}
      : {
          audio: {
            codecName: audio.codecName,
            ...(audio.profile === undefined ? {} : { profile: audio.profile }),
          },
        }),
  };
}

interface ParsedStream {
  type: 'video' | 'audio';
  codecName: string;
  profile?: string;
  pixelFormat?: string;
  width?: number;
  height?: number;
  defaultStream: boolean;
  attachedPicture: boolean;
}

function parseStream(value: unknown): ParsedStream | undefined {
  if (!isRecord(value)) {
    throw probeError('invalid_response');
  }

  if (value.codec_type !== 'video' && value.codec_type !== 'audio') {
    return undefined;
  }

  const disposition = value.disposition;
  const defaultStream = readFlag(disposition, 'default');
  const attachedPicture = readFlag(disposition, 'attached_pic');

  return {
    type: value.codec_type,
    codecName: readToken(
      value.codec_name,
      MAX_CODEC_NAME_LENGTH,
      /^[a-z0-9_]+$/,
    ),
    ...(value.profile === undefined
      ? {}
      : { profile: readText(value.profile, MAX_PROFILE_LENGTH) }),
    ...(value.pix_fmt === undefined
      ? {}
      : {
          pixelFormat: readToken(
            value.pix_fmt,
            MAX_PIXEL_FORMAT_LENGTH,
            /^[a-z0-9_]+$/,
          ),
        }),
    ...(value.width === undefined
      ? {}
      : { width: readInteger(value.width, 1, MAX_DIMENSION) }),
    ...(value.height === undefined
      ? {}
      : { height: readInteger(value.height, 1, MAX_DIMENSION) }),
    defaultStream,
    attachedPicture,
  };
}

function selectPrimaryStream(
  streams: Array<ParsedStream | undefined>,
  type: ParsedStream['type'],
): ParsedStream | undefined {
  const matching = streams.filter(
    (stream): stream is ParsedStream =>
      stream !== undefined &&
      stream.type === type &&
      (type !== 'video' || !stream.attachedPicture),
  );
  return matching.find((stream) => stream.defaultStream) ?? matching[0];
}

function parseFormatNames(value: unknown): string[] {
  if (!isRecord(value)) {
    throw probeError('invalid_response');
  }

  const raw = readText(value.format_name, 256);
  const names = raw.split(',');

  if (
    names.length === 0 ||
    names.length > MAX_FORMAT_NAMES ||
    names.some((name) => !/^[a-z0-9_]+$/.test(name))
  ) {
    throw probeError('invalid_response');
  }

  return [...new Set(names)];
}

function readFlag(value: unknown, name: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (!isRecord(value)) {
    throw probeError('invalid_response');
  }

  const flag = value[name];

  if (flag === undefined) {
    return false;
  }

  if (flag !== 0 && flag !== 1) {
    throw probeError('invalid_response');
  }

  return flag === 1;
}

function readToken(value: unknown, maxLength: number, pattern: RegExp): string {
  const text = readText(value, maxLength).toLowerCase();

  if (!pattern.test(text)) {
    throw probeError('invalid_response');
  }

  return text;
}

function readText(value: unknown, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw probeError('invalid_response');
  }

  return value;
}

function readInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw probeError('invalid_response');
  }

  return value;
}

function createFfprobeArgs(
  url: URL,
  config: TorrentPlaybackMediaProbeConfig,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-cpucount',
    '1',
    '-max_alloc',
    String(MAX_ALLOC_BYTES),
    '-protocol_whitelist',
    'http,https,tcp,tls',
    '-max_redirects',
    '0',
    '-rw_timeout',
    String(config.timeoutMs * 1_000),
    '-analyzeduration',
    String(config.analyzeDurationUs),
    '-probesize',
    String(config.probeSizeBytes),
    '-show_entries',
    'format=format_name:stream=codec_type,codec_name,profile,pix_fmt,width,height:stream_disposition=default,attached_pic',
    '-of',
    'json',
    url.href,
  ];
}

function executeFfprobe(
  executablePath: string,
  args: string[],
  options: FfprobeExecutionOptions,
): Promise<FfprobeExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      executablePath,
      args,
      {
        encoding: 'utf8',
        env: { LANG: 'C', LC_ALL: 'C' },
        killSignal: 'SIGKILL',
        maxBuffer: options.maxOutputBytes,
        signal: options.signal,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            error instanceof Error
              ? error
              : new Error('Media inspection process failed.'),
          );
          return;
        }

        resolve({ stdout, stderr });
      },
    );

    child.stdin?.end();
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTimeoutError(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' &&
    (error.code === 'ETIMEDOUT' ||
      (error.killed === true && error.signal === 'SIGKILL'))
  );
}

function isUnavailableError(error: unknown): boolean {
  return (
    isRecord(error) && (error.code === 'ENOENT' || error.code === 'EACCES')
  );
}

function probeError(code: TorrentMediaProbeErrorCode): TorrentMediaProbeError {
  const messages: Record<TorrentMediaProbeErrorCode, string> = {
    aborted: 'Media inspection was cancelled.',
    timeout: 'Media inspection exceeded its configured time budget.',
    unavailable: 'The configured media inspection runtime is unavailable.',
    invalid_response: 'Media inspection did not return valid bounded metadata.',
  };
  return new TorrentMediaProbeError(code, messages[code]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
