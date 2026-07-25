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
import { selectTorrentFile } from './file-selection';
import {
  createSessionRecord,
  failSessionRecord,
  type InternalTorrentPlaybackSession,
  updateSessionRecord,
} from './session-record';
import { isTorrServerClientError } from './torrserver';
import {
  TorrentResourcePool,
  type TorrentPlaybackTorrServerClient,
} from './torrent-resource-pool';
import type {
  CreateTorrentPlaybackSessionInput,
  TorrentPlaybackSessionSnapshot,
  TorrentPlaybackSessionState,
} from './types';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export type { TorrentPlaybackTorrServerClient } from './torrent-resource-pool';

interface TorrentPlaybackSessionDependencies {
  now?: () => number;
  createId?: () => string;
  setTimer?: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class TorrentPlaybackSessionService {
  private readonly sessions = new Map<string, InternalTorrentPlaybackSession>();
  private readonly resourcePool: TorrentResourcePool | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly setTimer: TorrentPlaybackSessionDependencies['setTimer'];
  private readonly clearTimer: TorrentPlaybackSessionDependencies['clearTimer'];
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

    const { candidate, infoHash, magnet } = revalidatePlaybackCandidate(
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
      magnet,
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

      const compatibility = selection.selected.compatibility;
      return this.updateSession(
        session,
        compatibility === 'direct' ? 'ready' : 'conversion_required',
        {
          compatibility,
          selectedFile: selection.selected,
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
        (isTorrentPlaybackSessionError(error) && error.code === 'aborted')
      ) {
        await this.stopInternal(session);
        throw abortedError();
      }

      if (isTorrentPlaybackSessionError(error)) {
        await this.removeFailedCreation(session);
        throw error;
      }

      const failed = this.failSession(
        session,
        mapUpstreamErrorCode(error),
        'TorServer could not prepare the selected torrent.',
      );
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
      'compatibility' | 'selectedFile' | 'files'
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

  private clearExpiryTimer(session: InternalTorrentPlaybackSession): void {
    if (session.expiryTimer !== undefined) {
      this.clearTimer!(session.expiryTimer);
      session.expiryTimer = undefined;
    }
  }
}

function mapUpstreamErrorCode(error: unknown): string {
  return isTorrServerClientError(error)
    ? `torrserver_${error.code}`
    : 'torrserver_unavailable';
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
