import { execFile } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { TorrentMediaRemuxConfig } from './media-remux-config';
import type { TorrServerPlayTarget } from './torrserver';
import type { TorrentPlaybackFile } from './types';

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_ALLOC_BYTES = 64 * 1024 ** 2;

export type TorrentMediaRemuxContainer = 'mp4' | 'webm' | 'ogg';
export type TorrentMediaRemuxErrorCode =
  'aborted' | 'timeout' | 'unavailable' | 'output_limit' | 'failed';

export class TorrentMediaRemuxError extends Error {
  override readonly name = 'TorrentMediaRemuxError';

  constructor(
    readonly code: TorrentMediaRemuxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TorrentMediaRemuxInput {
  target: TorrServerPlayTarget;
  file: TorrentPlaybackFile;
  container: TorrentMediaRemuxContainer;
  signal?: AbortSignal;
}

export interface TorrentMediaRemuxResult {
  id: string;
  target: { url: URL };
  length: number;
  container: TorrentMediaRemuxContainer;
  contentType: string;
}

export interface TorrentMediaRemuxer {
  remux(input: TorrentMediaRemuxInput): Promise<TorrentMediaRemuxResult>;
  release(
    result: TorrentMediaRemuxResult,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface TorrentMediaRemuxExecutionInput extends TorrentMediaRemuxInput {
  outputPath: string;
}

export interface TorrentMediaRemuxExecutionResult {
  path: string;
  length: number;
  container: TorrentMediaRemuxContainer;
  contentType: string;
}

export interface TorrentMediaRemuxExecutor {
  remux(
    input: TorrentMediaRemuxExecutionInput,
  ): Promise<TorrentMediaRemuxExecutionResult>;
}

interface FfmpegExecutionOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}

export type FfmpegExecutor = (
  executablePath: string,
  args: string[],
  options: FfmpegExecutionOptions,
) => Promise<void>;

export class FfmpegTorrentMediaRemuxExecutor implements TorrentMediaRemuxExecutor {
  constructor(
    private readonly config: TorrentMediaRemuxConfig,
    private readonly execute: FfmpegExecutor = executeFfmpeg,
  ) {}

  async remux(
    input: TorrentMediaRemuxExecutionInput,
  ): Promise<TorrentMediaRemuxExecutionResult> {
    if (input.signal?.aborted) throw remuxError('aborted');
    if (input.file.length > this.config.maxOutputBytes) {
      throw remuxError('output_limit');
    }

    try {
      await this.execute(
        this.config.executablePath,
        createFfmpegArgs(input, this.config),
        {
          signal: input.signal,
          timeoutMs: this.config.timeoutMs,
          maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
        },
      );
      const output = await stat(input.outputPath);

      if (
        !output.isFile() ||
        output.size <= 0 ||
        output.size >= this.config.maxOutputBytes
      ) {
        throw remuxError('output_limit');
      }

      return {
        path: input.outputPath,
        length: output.size,
        container: input.container,
        contentType: containerContentType(input.container),
      };
    } catch (error) {
      await unlink(input.outputPath).catch(() => undefined);

      if (error instanceof TorrentMediaRemuxError) throw error;
      if (input.signal?.aborted || isAbortError(error)) {
        throw remuxError('aborted');
      }
      if (isTimeoutError(error)) throw remuxError('timeout');
      if (isUnavailableError(error)) throw remuxError('unavailable');
      throw remuxError('failed');
    }
  }
}

export function isTorrentMediaRemuxError(
  error: unknown,
): error is TorrentMediaRemuxError {
  return error instanceof TorrentMediaRemuxError;
}

export function containerExtension(
  container: TorrentMediaRemuxContainer,
): string {
  return container === 'ogg' ? 'ogv' : container;
}

export function containerContentType(
  container: TorrentMediaRemuxContainer,
): string {
  const values: Record<TorrentMediaRemuxContainer, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
  };
  return values[container];
}

export async function prepareTorrentMediaRemuxDirectory(
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^[A-Za-z0-9_-]{43}\.(?:mp4|webm|ogv)$/.test(entry.name),
      )
      .map((entry) => unlink(join(directory, entry.name))),
  );
}

function createFfmpegArgs(
  input: TorrentMediaRemuxExecutionInput,
  config: TorrentMediaRemuxConfig,
): string[] {
  const formatArgs =
    input.container === 'mp4'
      ? ['-movflags', '+faststart', '-f', 'mp4']
      : ['-f', input.container];

  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-cpucount',
    '1',
    '-max_alloc',
    String(MAX_ALLOC_BYTES),
    '-threads',
    '1',
    '-protocol_whitelist',
    'http,https,tcp,tls',
    '-max_redirects',
    '0',
    '-rw_timeout',
    String(config.timeoutMs * 1_000),
    '-i',
    input.target.url.href,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c',
    'copy',
    '-sn',
    '-dn',
    '-fs',
    String(config.maxOutputBytes),
    ...formatArgs,
    '-y',
    input.outputPath,
  ];
}

function executeFfmpeg(
  executablePath: string,
  args: string[],
  options: FfmpegExecutionOptions,
): Promise<void> {
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
      (error) => {
        if (error !== null) {
          reject(
            error instanceof Error
              ? error
              : new Error('Media remux process failed.'),
          );
          return;
        }

        resolve();
      },
    );

    child.stdin?.end();
  });
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
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

function remuxError(code: TorrentMediaRemuxErrorCode): TorrentMediaRemuxError {
  const messages: Record<TorrentMediaRemuxErrorCode, string> = {
    aborted: 'Media remux was cancelled.',
    timeout: 'Media remux exceeded its configured time budget.',
    unavailable: 'The configured media remux runtime is unavailable.',
    output_limit: 'Media remux exceeded its configured output limit.',
    failed: 'The selected media could not be remuxed safely.',
  };
  return new TorrentMediaRemuxError(code, messages[code]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
