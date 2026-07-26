import { randomBytes } from 'node:crypto';
import {
  isSafeCandidateReference,
  TorrentCandidateCatalog,
} from './candidate-catalog';
import { revalidatePlaybackCandidate } from './candidate-validation';
import type { TorrentPlaybackConfig } from './config';
import {
  isTorrentPlaybackSessionError,
  TorrentPlaybackSessionError,
} from './errors';
import {
  browserTargetContainer,
  classifyProbedTorrentFile,
  selectTorrentFile,
} from './file-selection';
import {
  isTorrentMediaProbeError,
  type TorrentMediaProbe,
} from './media-probe';
import {
  containerExtension,
  isTorrentMediaRemuxError,
  type TorrentMediaRemuxContainer,
  type TorrentMediaRemuxer,
} from './media-remux';
import {
  createSessionRecord,
  failSessionRecord,
  type InternalTorrentPlaybackSession,
  updateSessionRecord,
} from './session-record';
import {
  isTorrServerClientError,
  type TorrServerPlayTarget,
} from './torrserver';
import {
  TorrentResourcePool,
  type TorrentPlaybackTorrServerClient,
} from './torrent-resource-pool';
import type {
  CreateTorrentPlaybackSessionInput,
  TorrentPlaybackFile,
  TorrentPlaybackSessionSnapshot,
  TorrentPlaybackSessionState,
  TorrentPlaybackStreamSource,
} from './types';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_MEDIA_PROBE_ATTEMPTS = 2;

export type { TorrentPlaybackTorrServerClient } from './torrent-resource-pool';

interface TorrentPlaybackSessionDependencies {
  now?: () => number;
  createId?: () => string;
  setTimer?: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  mediaProbe?: TorrentMediaProbe;
  mediaRemuxer?: TorrentMediaRemuxer;
}

export class TorrentPlaybackSessionService {
  private readonly sessions = new Map<string, InternalTorrentPlaybackSession>();
  private readonly resourcePool: TorrentResourcePool | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly setTimer: TorrentPlaybackSessionDependencies['setTimer'];
  private readonly clearTimer: TorrentPlaybackSessionDependencies['clearTimer'];
  private readonly mediaProbe: TorrentMediaProbe | undefined;
  private readonly mediaRemuxer: TorrentMediaRemuxer | undefined;
  private startingSessions = 0;
  private shuttingDown = false;

  constructor(
    private readonly catalog: TorrentCandidateCatalog,
    private readonly client: TorrentPlaybackTorrServerClient | undefined,
    private readonly config: TorrentPlaybackConfig,
    dependencies: TorrentPlaybackSessionDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.createId =
      dependencies.createId ?? (() => randomBytes(32).toString('base64url'));
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
    this.mediaProbe = dependencies.mediaProbe;
    this.mediaRemuxer = dependencies.mediaRemuxer;
    this.resourcePool =
      client === undefined ? undefined : new TorrentResourcePool(client);
  }

  async createSession(
    input: CreateTorrentPlaybackSessionInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<TorrentPlaybackSessionSnapshot> {
    if (this.client === undefined || this.shuttingDown) {
      throw new TorrentPlaybackSessionError(
        'disabled',
        'Reference torrent playback is disabled.',
      );
    }

    if (!isSafeCandidateReference(input.provider, input.candidateId)) {
      throw new TorrentPlaybackSessionError(
        'candidate_not_found',
        'The selected torrent candidate is unavailable.',
      );
    }

    if (
      input.fileId !== undefined &&
      (!Number.isSafeInteger(input.fileId) || input.fileId < 1)
    ) {
      throw new TorrentPlaybackSessionError(
        'invalid_file_selection',
        'The selected torrent file is invalid.',
      );
    }

    const catalogued = this.catalog.get(input.provider, input.candidateId);

    if (catalogued === undefined) {
      throw new TorrentPlaybackSessionError(
        'candidate_not_found',
        'The selected torrent candidate is unavailable or no longer fresh.',
      );
    }

    const { candidate, infoHash, handoff } = revalidatePlaybackCandidate(
      catalogued,
      input,
      this.now(),
    );
    this.ensureCapacity();

    if (this.startingSessions >= this.config.maxStartingSessions) {
      throw new TorrentPlaybackSessionError(
        'start_capacity_exceeded',
        'The torrent playback start limit is currently reached.',
      );
    }

    if (options.signal?.aborted) {
      throw abortedError();
    }

    const session = this.createStartingSession(input, infoHash);
    this.sessions.set(session.id, session);
    this.startingSessions += 1;
    const resource = this.resourcePool!.acquire(
      infoHash,
      handoff,
      candidate.title,
    );
    session.resource = resource;
    let startTimedOut = false;
    const onCallerAbort = () => session.controller.abort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const startTimer = this.setTimer!(() => {
      startTimedOut = true;
      session.controller.abort();
    }, this.config.startTimeoutMs);
    unrefTimer(startTimer);

    try {
      const torrent = await waitForPromise(
        resource.promise,
        session.controller.signal,
      );

      if (session.state === 'stopped' || options.signal?.aborted) {
        throw abortedError();
      }

      const selection = selectTorrentFile(
        torrent.files,
        candidate,
        catalogued.query,
        input.fileId,
        this.config.maxOfferedFiles,
      );

      if (input.fileId !== undefined && selection.selected === undefined) {
        throw new TorrentPlaybackSessionError(
          'invalid_file_selection',
          'The selected torrent file is unavailable or is not a video file.',
        );
      }

      if (selection.selected === undefined) {
        if (selection.offeredFiles.length === 0) {
          const failed = this.failSession(
            session,
            'no_playable_files',
            'TorServer metadata did not contain a bounded video file.',
          );
          await this.releaseResource(session);
          return failed;
        }

        return this.updateSession(session, 'file_selection_required', {
          files: selection.offeredFiles,
        });
      }

      const inspected = await this.inspectSelectedFile(
        session,
        selection.selected,
        candidate,
      );
      const selectedFile = inspected.file;
      const compatibility = selectedFile.compatibility;

      if (
        compatibility === 'remux_required' &&
        inspected.remuxContainer !== undefined &&
        this.mediaRemuxer !== undefined
      ) {
        const snapshot = this.updateSession(session, 'starting', {
          compatibility,
          selectedFile,
        });
        session.remuxTask = this.runRemux(
          session,
          selectedFile,
          inspected.remuxContainer,
        );
        return snapshot;
      }

      return this.updateSession(
        session,
        compatibility === 'direct' ? 'ready' : 'conversion_required',
        {
          compatibility,
          ...(compatibility === 'direct'
            ? { playbackMode: 'direct' as const }
            : {}),
          selectedFile,
        },
      );
    } catch (error) {
      if (
        startTimedOut &&
        !options.signal?.aborted &&
        session.state !== 'stopped'
      ) {
        const failed = this.failSession(
          session,
          'start_timeout',
          'Torrent playback did not start within the configured budget.',
        );
        await this.releaseResource(session);
        return failed;
      }

      if (
        options.signal?.aborted ||
        session.state === 'stopped' ||
        (isTorrentPlaybackSessionError(error) && error.code === 'aborted') ||
        (isTorrentMediaProbeError(error) && error.code === 'aborted')
      ) {
        await this.stopInternal(session);
        throw abortedError();
      }

      if (isTorrentPlaybackSessionError(error)) {
        await this.removeFailedCreation(session);
        throw error;
      }

      const failure = mapPreparationFailure(error);
      const failed = this.failSession(session, failure.code, failure.message);
      await this.releaseResource(session);
      return failed;
    } finally {
      this.clearTimer!(startTimer);
      options.signal?.removeEventListener('abort', onCallerAbort);
      this.startingSessions -= 1;
    }
  }

  getSession(sessionId: string): TorrentPlaybackSessionSnapshot {
    const session = this.sessions.get(sessionId);

    if (session === undefined || session.expiresAtMs <= this.now()) {
      if (session !== undefined) {
        void this.expireSession(session);
      }

      throw sessionNotFoundError();
    }

    return structuredClone(session.snapshot);
  }

  getStreamSource(sessionId: string): TorrentPlaybackStreamSource {
    if (this.client === undefined || this.shuttingDown) {
      throw new TorrentPlaybackSessionError(
        'disabled',
        'Reference torrent playback is disabled.',
      );
    }

    const session = this.getActiveSession(sessionId);
    const selectedFile = session.snapshot.selectedFile;

    if (selectedFile === undefined || session.state !== 'ready') {
      throw new TorrentPlaybackSessionError(
        'session_not_streamable',
        'The playback session does not have a selected streamable file.',
      );
    }

    if (session.remuxResult !== undefined) {
      return {
        target: {
          url: new URL(session.remuxResult.target.url),
          kind: 'media_worker',
        },
        file: {
          id: selectedFile.id,
          path: `remux.${containerExtension(session.remuxResult.container)}`,
          length: session.remuxResult.length,
          compatibility: 'direct',
        },
        signal: session.controller.signal,
      };
    }

    return {
      target: {
        ...this.client.createPlayTarget(session.infoHash, selectedFile.id),
        kind: 'torrserver',
      },
      file: structuredClone(selectedFile),
      signal: session.controller.signal,
    };
  }

  async stopSession(
    sessionId: string,
  ): Promise<TorrentPlaybackSessionSnapshot> {
    const session = this.sessions.get(sessionId);

    if (session === undefined || session.expiresAtMs <= this.now()) {
      if (session !== undefined) {
        await this.expireSession(session);
      }

      throw sessionNotFoundError();
    }

    await this.stopInternal(session);
    return structuredClone(session.snapshot);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const sessions = [...this.sessions.values()];
    await Promise.allSettled(
      sessions.map((session) => this.stopInternal(session)),
    );
    this.sessions.clear();
  }

  private ensureCapacity(): void {
    if (this.sessions.size < this.config.maxSessions) {
      return;
    }

    for (const [id, session] of this.sessions) {
      if (session.state === 'failed' || session.state === 'stopped') {
        this.clearExpiryTimer(session);
        this.sessions.delete(id);

        if (this.sessions.size < this.config.maxSessions) {
          return;
        }
      }
    }

    throw new TorrentPlaybackSessionError(
      'session_capacity_exceeded',
      'The torrent playback session limit is currently reached.',
    );
  }

  private async inspectSelectedFile(
    session: InternalTorrentPlaybackSession,
    file: TorrentPlaybackFile,
    candidate: Parameters<typeof selectTorrentFile>[1],
  ): Promise<{
    file: TorrentPlaybackFile;
    remuxContainer?: TorrentMediaRemuxContainer;
  }> {
    if (this.mediaProbe === undefined) {
      return { file };
    }

    const target = this.client!.createPlayTarget(session.infoHash, file.id);
    let result;

    try {
      result = await this.probeSelectedFile(session, target, file);
    } catch (error) {
      if (
        isTorrentMediaProbeError(error) &&
        error.code === 'timeout' &&
        isTrustedYtsDirectFallback(candidate, file)
      ) {
        return { file };
      }

      throw error;
    }
    const compatibility = classifyProbedTorrentFile(file.path, result);
    return {
      file: { ...file, compatibility },
      ...(compatibility === 'remux_required'
        ? { remuxContainer: browserTargetContainer(result) }
        : {}),
    };
  }

  private async probeSelectedFile(
    session: InternalTorrentPlaybackSession,
    target: TorrServerPlayTarget,
    file: TorrentPlaybackFile,
  ) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_MEDIA_PROBE_ATTEMPTS; attempt += 1) {
      try {
        return await this.mediaProbe!.probe({
          target,
          file,
          signal: session.controller.signal,
        });
      } catch (error) {
        lastError = error;

        if (
          attempt === MAX_MEDIA_PROBE_ATTEMPTS ||
          session.controller.signal.aborted ||
          !isTorrentMediaProbeError(error) ||
          error.code !== 'timeout'
        ) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async runRemux(
    session: InternalTorrentPlaybackSession,
    file: TorrentPlaybackFile,
    container: TorrentMediaRemuxContainer,
  ): Promise<void> {
    try {
      const result = await this.mediaRemuxer!.remux({
        target: this.client!.createPlayTarget(session.infoHash, file.id),
        file,
        container,
        signal: session.controller.signal,
      });

      if (session.state === 'stopped' || session.controller.signal.aborted) {
        await this.mediaRemuxer!.release(result).catch(() => undefined);
        return;
      }

      session.remuxResult = result;
      this.updateSession(session, 'ready', {
        compatibility: 'remux_required',
        playbackMode: 'remux',
        selectedFile: file,
      });
      await this.releaseResource(session);
    } catch (error) {
      if (session.state === 'stopped' || session.controller.signal.aborted) {
        return;
      }

      const failure = mapRemuxFailure(error);
      this.failSession(session, failure.code, failure.message);
      await this.releaseResource(session);
    }
  }

  private getActiveSession(sessionId: string): InternalTorrentPlaybackSession {
    const session = this.sessions.get(sessionId);

    if (session === undefined || session.expiresAtMs <= this.now()) {
      if (session !== undefined) {
        void this.expireSession(session);
      }

      throw sessionNotFoundError();
    }

    return session;
  }

  private createStartingSession(
    input: CreateTorrentPlaybackSessionInput,
    infoHash: string,
  ): InternalTorrentPlaybackSession {
    const now = this.now();
    const id = this.generateSessionId();
    const session = createSessionRecord(
      id,
      input,
      infoHash,
      now,
      this.config.sessionTtlMs,
    );
    const expiryTimer = this.setTimer!(() => {
      void this.expireSession(session);
    }, this.config.sessionTtlMs);
    session.expiryTimer = expiryTimer;
    unrefTimer(expiryTimer);
    return session;
  }

  private generateSessionId(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const id = this.createId();

      if (SESSION_ID_PATTERN.test(id) && !this.sessions.has(id)) {
        return id;
      }
    }

    throw new Error('Could not generate a unique high-entropy session ID.');
  }

  private updateSession(
    session: InternalTorrentPlaybackSession,
    state: TorrentPlaybackSessionState,
    values: Pick<
      TorrentPlaybackSessionSnapshot,
      'compatibility' | 'playbackMode' | 'selectedFile' | 'files'
    > = {},
  ): TorrentPlaybackSessionSnapshot {
    return updateSessionRecord(session, state, this.now(), values);
  }

  private failSession(
    session: InternalTorrentPlaybackSession,
    code: string,
    message: string,
  ): TorrentPlaybackSessionSnapshot {
    return failSessionRecord(session, this.now(), code, message);
  }

  private async stopInternal(
    session: InternalTorrentPlaybackSession,
  ): Promise<void> {
    if (session.state !== 'stopped') {
      session.controller.abort();
      this.updateSession(session, 'stopped');
    }

    if (session.remuxTask !== undefined) {
      await session.remuxTask.catch(() => undefined);
    }
    if (session.remuxResult !== undefined) {
      await this.releaseRemuxResult(session);
    }
    await this.releaseResource(session);
  }

  private async removeFailedCreation(
    session: InternalTorrentPlaybackSession,
  ): Promise<void> {
    this.clearExpiryTimer(session);
    this.sessions.delete(session.id);
    await this.releaseResource(session);
  }

  private async expireSession(
    session: InternalTorrentPlaybackSession,
  ): Promise<void> {
    await this.stopInternal(session);
    this.clearExpiryTimer(session);
    this.sessions.delete(session.id);
  }

  private async releaseResource(
    session: InternalTorrentPlaybackSession,
  ): Promise<void> {
    const resource = session.resource;

    if (resource === undefined || session.resourceReleased) {
      return;
    }

    session.resourceReleased = true;
    await this.resourcePool!.release(resource);
  }

  private async releaseRemuxResult(
    session: InternalTorrentPlaybackSession,
  ): Promise<void> {
    const result = session.remuxResult;
    if (result === undefined || this.mediaRemuxer === undefined) return;
    session.remuxResult = undefined;
    await this.mediaRemuxer.release(result).catch(() => undefined);
  }

  private clearExpiryTimer(session: InternalTorrentPlaybackSession): void {
    if (session.expiryTimer !== undefined) {
      this.clearTimer!(session.expiryTimer);
      session.expiryTimer = undefined;
    }
  }
}

function isTrustedYtsDirectFallback(
  candidate: Parameters<typeof selectTorrentFile>[1],
  file: TorrentPlaybackFile,
): boolean {
  const codec = candidate.release?.videoCodec?.toLowerCase();
  const path = file.path.toLowerCase();

  return (
    candidate.provider === 'yts-torrent' &&
    candidate.handoff.kind === 'torrent_file' &&
    file.compatibility === 'direct' &&
    (path.endsWith('.mp4') || path.endsWith('.m4v')) &&
    codec !== undefined &&
    (codec.includes('x264') ||
      codec.includes('h264') ||
      codec.includes('h.264') ||
      codec.includes('avc'))
  );
}

function mapPreparationFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (isTorrentMediaProbeError(error)) {
    return {
      code:
        error.code === 'timeout' ? 'media_probe_timeout' : 'media_probe_failed',
      message:
        error.code === 'timeout'
          ? 'Media inspection did not finish within the configured budget.'
          : 'The selected media file could not be inspected safely.',
    };
  }

  return {
    code: isTorrServerClientError(error)
      ? `torrserver_${error.code}`
      : 'torrserver_unavailable',
    message: 'TorServer could not prepare the selected torrent.',
  };
}

function mapRemuxFailure(error: unknown): { code: string; message: string } {
  if (isTorrentMediaRemuxError(error)) {
    if (error.code === 'timeout') {
      return {
        code: 'media_remux_timeout',
        message: 'Media remux did not finish within the configured budget.',
      };
    }

    if (error.code === 'output_limit') {
      return {
        code: 'media_remux_output_limit',
        message: 'The selected media exceeds the configured remux limit.',
      };
    }
  }

  return {
    code: 'media_remux_failed',
    message: 'The selected media file could not be remuxed safely.',
  };
}

function sessionNotFoundError(): TorrentPlaybackSessionError {
  return new TorrentPlaybackSessionError(
    'session_not_found',
    'The torrent playback session was not found.',
  );
}

function abortedError(): TorrentPlaybackSessionError {
  return new TorrentPlaybackSessionError(
    'aborted',
    'Torrent playback session creation was cancelled.',
  );
}

function waitForPromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortedError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          error instanceof Error
            ? error
            : new Error('TorServer preparation rejected without an Error.'),
        );
      },
    );
  });
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}
