import { isIP } from 'node:net';
import type { MediaEngine, TorrentCandidate } from '@media-engine/core';
import type { OriginalTorrentSessionConfig } from './session.config';
import { TorrentSourceResolutionError } from './session.errors';
import type {
  CreateOriginalTorrentSessionInput,
  OriginalTorrentSourceResolver,
  ResolvedTorrentObservation,
} from './session.types';

const INFO_HASH = /^[a-f\d]{40}$/iu;
const MAX_SOURCE_URL_LENGTH = 2_048;

export type TorrentSourceFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export class ServerTorrentSourceResolver implements OriginalTorrentSourceResolver {
  constructor(
    private readonly mediaEngine: Pick<MediaEngine, 'discoverTorrents'>,
    private readonly config: OriginalTorrentSessionConfig,
    private readonly fetch: TorrentSourceFetch = globalThis.fetch,
  ) {}

  async resolve(
    input: CreateOriginalTorrentSessionInput,
    signal: AbortSignal,
  ): Promise<ResolvedTorrentObservation> {
    let response;
    try {
      response = await this.mediaEngine.discoverTorrents(
        {
          ...input.query,
          providers: [input.observation.provider],
          limit: 100,
        },
        { signal },
      );
    } catch {
      if (signal.aborted) throw readAbortReason(signal);
      throw new TorrentSourceResolutionError(
        'The selected torrent observation could not be resolved again.',
        true,
      );
    }

    const matching = response.candidates.filter(
      (candidate) =>
        candidate.provider === input.observation.provider &&
        candidate.id === input.observation.id,
    );
    if (matching.length !== 1) {
      throw new TorrentSourceResolutionError(
        'The selected torrent observation is missing, ambiguous, or expired.',
        true,
      );
    }

    const candidate = matching[0];
    const expectedHash = normalizeExpectedHash(candidate);
    if (candidate.handoff.kind === 'magnet') {
      return {
        candidate,
        source: {
          kind: 'magnet',
          uri: candidate.handoff.uri,
          expectedHash,
          title: candidate.title,
        },
      };
    }
    if (candidate.handoff.kind !== 'torrent_file') {
      throw new TorrentSourceResolutionError(
        'The selected torrent observation does not provide a supported server-owned handoff.',
      );
    }
    if (
      candidate.handoff.method !== undefined &&
      candidate.handoff.method !== 'GET'
    ) {
      throw new TorrentSourceResolutionError(
        'The selected torrent-file handoff uses an unsupported method.',
      );
    }
    if (
      candidate.handoff.headers !== undefined ||
      candidate.handoff.referer !== undefined
    ) {
      throw new TorrentSourceResolutionError(
        'The selected torrent-file handoff requires unsupported forwarding metadata.',
      );
    }

    const url = parsePublicSourceUrl(candidate.handoff.uri);
    const bytes = await this.fetchTorrentFile(url, signal);
    return {
      candidate,
      source: {
        kind: 'torrent_file',
        bytes,
        expectedHash,
        title: candidate.title,
      },
    };
  }

  private async fetchTorrentFile(
    url: URL,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.sourceRequestTimeoutMs);

    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/x-bittorrent, application/octet-stream',
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok || response.status !== 200) {
        throw new TorrentSourceResolutionError(
          'The provider torrent-file handoff returned an unsuccessful response.',
          response.status >= 500 || response.status === 429,
        );
      }
      const declaredLength = readContentLength(response.headers);
      if (
        declaredLength !== undefined &&
        declaredLength > this.config.maxTorrentBytes
      ) {
        throw new TorrentSourceResolutionError(
          'The provider torrent-file handoff exceeds the configured size limit.',
        );
      }
      return await readBoundedBody(response, this.config.maxTorrentBytes);
    } catch (error) {
      if (signal.aborted) throw readAbortReason(signal);
      if (error instanceof TorrentSourceResolutionError) throw error;
      throw new TorrentSourceResolutionError(
        timedOut
          ? 'The provider torrent-file handoff timed out.'
          : 'The provider torrent-file handoff could not be downloaded safely.',
        true,
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

function readAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Torrent source resolution was cancelled.');
}

function normalizeExpectedHash(candidate: TorrentCandidate): string {
  const hash = candidate.infoHash?.toLowerCase();
  if (hash === undefined || !INFO_HASH.test(hash)) {
    throw new TorrentSourceResolutionError(
      'The selected torrent observation has no valid expected info hash.',
    );
  }
  return hash;
}

function parsePublicSourceUrl(value: string): URL {
  if (value.length > MAX_SOURCE_URL_LENGTH) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff URL is too long.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff URL is invalid.',
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    isForbiddenLiteralHost(url.hostname)
  ) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff URL is not an allowed public HTTP(S) target.',
    );
  }
  return url;
}

function isForbiddenLiteralHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost'))
    return true;
  const version = isIP(normalized);
  if (version === 4) {
    const [a = 0, b = 0] = normalized.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('ff')
    );
  }
  return false;
}

function readContentLength(headers: Headers): number | undefined {
  const value = headers.get('content-length');
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff returned an invalid Content-Length.',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff returned an invalid Content-Length.',
    );
  }
  return parsed;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff returned an empty response body.',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TorrentSourceResolutionError(
          'The provider torrent-file handoff exceeds the configured size limit.',
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) {
    throw new TorrentSourceResolutionError(
      'The torrent-file handoff returned an empty response body.',
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
