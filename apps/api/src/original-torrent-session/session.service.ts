import { randomBytes } from 'node:crypto';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { OriginalTorrentSessionTelemetryEvent } from '../original-torrent-observability/observability.types';
import { isOriginalTorrentRuntimeError } from '../original-torrent-runtime/runtime.errors';
import { selectRegularTorrentFiles } from './file-selection';
import type { OriginalTorrentSessionConfig } from './session.config';
import {
  mapSessionFailure,
  OriginalTorrentSessionCapacityError,
  OriginalTorrentSessionConflictError,
  OriginalTorrentSessionNotFoundError,
  OriginalTorrentStreamCapabilityError,
} from './session.errors';
import type {
  CreateOriginalTorrentSessionInput,
  OriginalTorrentRuntimeAdapter,
  OriginalTorrentSessionFailure,
  OriginalTorrentSessionRecord,
  OriginalTorrentSessionSnapshot,
  OriginalTorrentSourceResolver,
  OriginalTorrentStreamAccess,
  SharedTorrentResource,
} from './session.types';

interface OriginalTorrentSessionServiceDependencies {
  now?: () => number;
  createId?: () => string;
  createCapability?: () => string;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  report?: (event: OriginalTorrentSessionTelemetryEvent) => void;
}

export class OriginalTorrentSessionService
  implements OnApplicationShutdown, OnModuleInit
{
  private readonly sessions = new Map<string, OriginalTorrentSessionRecord>();
  private readonly resources = new Map<string, SharedTorrentResource>();
  private readonly capabilities = new Map<string, string>();
  private readonly retiredCapabilities = new Map<
    string,
    {
      error: OriginalTorrentSessionFailure;
      removeAtMs: number;
    }
  >();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly createCapability: () => string;
  private readonly clearInterval: typeof globalThis.clearInterval;
  private readonly report?: (
    event: OriginalTorrentSessionTelemetryEvent,
  ) => void;
  private readonly cleanupTimer: ReturnType<typeof globalThis.setInterval>;
  private shuttingDown = false;
  private activeCreations = 0;
  private activeSessionCount = 0;
  private resourceReferenceCount = 0;
  private sweepInProgress?: Promise<void>;
  private recoveryInProgress?: Promise<void>;
  private recovered = false;

  constructor(
    private readonly adapter: OriginalTorrentRuntimeAdapter | undefined,
    private readonly resolver: OriginalTorrentSourceResolver,
    private readonly config: OriginalTorrentSessionConfig,
    dependencies: OriginalTorrentSessionServiceDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? createRandomSessionId;
    this.createCapability =
      dependencies.createCapability ?? createRandomStreamCapability;
    this.clearInterval = dependencies.clearInterval ?? globalThis.clearInterval;
    this.report = dependencies.report;
    const setIntervalFunction =
      dependencies.setInterval ?? globalThis.setInterval;
    this.cleanupTimer = setIntervalFunction(() => {
      void this.sweepExpiredSessions();
    }, config.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureRecovered();
    } catch (error) {
      if (
        !isOriginalTorrentRuntimeError(error) ||
        error.code !== 'incompatible_version'
      ) {
        return;
      }
      throw error;
    }
  }

  create(
    input: CreateOriginalTorrentSessionInput,
  ): OriginalTorrentSessionSnapshot {
    if (this.shuttingDown) {
      throw new OriginalTorrentSessionConflictError(
        'torrserver_unavailable',
        'The API is shutting down and cannot create a torrent session.',
      );
    }
    if (this.activeCreations >= this.config.maxConcurrentCreations) {
      throw new OriginalTorrentSessionCapacityError();
    }

    this.activeCreations += 1;
    try {
      const now = this.now();
      const record: OriginalTorrentSessionRecord = {
        id: this.allocateSessionId(),
        state: 'adding',
        observation: { ...input.observation },
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + this.config.sessionTtlMs,
        controller: new AbortController(),
        resourceReleased: true,
      };
      this.sessions.set(record.id, record);
      this.activeSessionCount += 1;
      this.emit({ event: 'session_created', state: record.state });
      void this.runCreation(record, input).finally(() => {
        this.activeCreations -= 1;
      });
      return snapshot(record);
    } catch (error) {
      this.activeCreations -= 1;
      throw error;
    }
  }

  async get(id: string): Promise<OriginalTorrentSessionSnapshot> {
    const record = this.requireSession(id);
    await this.expireIfDue(record);
    return snapshot(record);
  }

  async selectFile(
    id: string,
    fileId: number,
  ): Promise<OriginalTorrentSessionSnapshot> {
    const record = this.requireSession(id);
    await this.expireIfDue(record);

    if (record.selectionInProgress !== undefined) {
      if (record.selectionFileId !== fileId) {
        throw new OriginalTorrentSessionConflictError(
          'torrent_file_selection_required',
          'Another offered file is already being selected for this session.',
        );
      }
      return record.selectionInProgress;
    }
    if (record.state !== 'selection_required' || record.files === undefined) {
      throw stateConflict(record);
    }
    const file = record.files.find((entry) => entry.id === fileId);
    if (file === undefined) {
      throw new OriginalTorrentSessionConflictError(
        'torrent_file_not_found',
        'The requested file ID was not offered by this session.',
      );
    }

    record.selectionFileId = fileId;
    record.selectionInProgress = this.completeSelection(
      record,
      file.id,
    ).finally(() => {
      record.selectionFileId = undefined;
      record.selectionInProgress = undefined;
    });
    return record.selectionInProgress;
  }

  async resolveStreamCapability(
    capability: string,
  ): Promise<OriginalTorrentStreamAccess> {
    const sessionId = this.capabilities.get(capability);
    if (sessionId === undefined) {
      const retired = this.retiredCapabilities.get(capability);
      if (retired !== undefined) {
        throw new OriginalTorrentStreamCapabilityError(
          mapCapabilityErrorCode(retired.error.code),
          retired.error.message,
          retired.error.transient,
        );
      }
      throw new OriginalTorrentStreamCapabilityError(
        'session_expired',
        'The original torrent stream capability is invalid or expired.',
        false,
      );
    }
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      this.capabilities.delete(capability);
      throw new OriginalTorrentStreamCapabilityError(
        'session_expired',
        'The original torrent stream capability is invalid or expired.',
        false,
      );
    }
    await this.expireIfDue(record);
    if (
      record.state !== 'ready' ||
      record.target === undefined ||
      record.streamCapability !== capability
    ) {
      throw new OriginalTorrentStreamCapabilityError(
        record.state === 'stopped' ? 'session_stopped' : 'session_expired',
        'The original torrent stream capability is no longer active.',
        false,
      );
    }
    try {
      if (this.adapter !== undefined && record.resource?.lease !== undefined) {
        await this.adapter.validateLease(record.resource.lease, {
          signal: record.controller.signal,
        });
      }
    } catch (error) {
      const failure = this.mapFailure(error);
      this.fail(record, failure);
      record.controller.abort(new Error('Original torrent runtime changed.'));
      await this.releaseSessionResource(record);
      throw new OriginalTorrentStreamCapabilityError(
        mapCapabilityErrorCode(failure.code),
        failure.message,
        failure.transient,
      );
    }
    return {
      sessionId: record.id,
      target: { ...record.target, url: new URL(record.target.url) },
      expiresAtMs: record.expiresAtMs,
      signal: record.controller.signal,
    };
  }

  async failStreamCapability(
    capability: string,
    failure: OriginalTorrentSessionFailure,
  ): Promise<void> {
    const sessionId = this.capabilities.get(capability);
    if (sessionId === undefined) return;
    const record = this.sessions.get(sessionId);
    if (record === undefined || record.state !== 'ready') return;
    this.fail(record, failure);
    record.controller.abort(new Error('Original torrent stream failed.'));
    await this.releaseSessionResource(record);
  }

  async stop(id: string): Promise<OriginalTorrentSessionSnapshot> {
    const record = this.requireSession(id);
    if (!isTerminal(record.state)) {
      this.makeTerminal(record, 'stopped', {
        code: 'session_stopped',
        message: 'The original torrent session was stopped.',
        transient: false,
      });
      record.controller.abort(new Error('Original torrent session stopped.'));
      await this.releaseSessionResource(record);
    }
    return snapshot(record);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.clearInterval(this.cleanupTimer);
    const active = [...this.sessions.values()].filter(
      (record) => !isTerminal(record.state),
    );
    await Promise.all(active.map((record) => this.stop(record.id)));
    await Promise.all(
      [...this.resources.values()].map(async (resource) => {
        resource.references.clear();
        await this.closeResource(resource);
      }),
    );
  }

  async sweepExpiredSessions(): Promise<void> {
    if (this.sweepInProgress !== undefined) return this.sweepInProgress;
    this.sweepInProgress = this.performSweep().finally(() => {
      this.sweepInProgress = undefined;
    });
    return this.sweepInProgress;
  }

  private async performSweep(): Promise<void> {
    const now = this.now();
    const releases: Promise<void>[] = [];
    for (const record of this.sessions.values()) {
      if (!isTerminal(record.state) && now >= record.expiresAtMs) {
        this.makeTerminal(record, 'expired', {
          code: 'session_expired',
          message: 'The original torrent session expired.',
          transient: false,
        });
        record.controller.abort(new Error('Original torrent session expired.'));
        releases.push(this.releaseSessionResource(record));
        continue;
      }
      if (
        isTerminal(record.state) &&
        record.terminalAtMs !== undefined &&
        now - record.terminalAtMs >= this.config.terminalRetentionMs &&
        record.resourceReleased
      ) {
        this.sessions.delete(record.id);
      }
    }
    for (const [capability, retired] of this.retiredCapabilities) {
      if (now >= retired.removeAtMs) {
        this.retiredCapabilities.delete(capability);
      }
    }
    await Promise.all(releases);
  }

  private async runCreation(
    record: OriginalTorrentSessionRecord,
    input: CreateOriginalTorrentSessionInput,
  ): Promise<void> {
    try {
      if (this.adapter === undefined) {
        this.fail(record, {
          code: 'torrserver_unavailable',
          message: 'The required TorrServer runtime is disabled.',
          transient: true,
        });
        return;
      }

      await this.ensureRecovered();
      if (isTerminal(record.state)) return;

      const resolved = await this.resolver.resolve(
        input,
        record.controller.signal,
      );
      if (isTerminal(record.state)) return;
      record.title = resolved.candidate.title;
      this.touch(record);

      const resource = await this.acquireResource(
        record.id,
        resolved.source,
        record.controller.signal,
      );
      record.resource = resource;
      record.resourceReleased = false;
      if (isTerminal(record.state)) {
        await this.releaseSessionResource(record);
        return;
      }
      if (resource.phase === 'waiting_metadata') {
        this.transition(record, 'waiting_metadata');
      }

      const status = await raceWithSignal(
        resource.preparation,
        record.controller.signal,
      );
      if (isTerminal(record.state)) return;
      const files = selectRegularTorrentFiles(status.files);
      record.files = files;
      if (files.length === 0) {
        this.fail(record, {
          code: 'torrent_file_not_found',
          message: 'Torrent metadata contains no selectable regular files.',
          transient: false,
        });
        await this.releaseSessionResource(record);
        return;
      }
      if (files.length > 1) {
        this.transition(record, 'selection_required');
        return;
      }
      await this.completeSelection(record, files[0].id);
    } catch (error) {
      if (isTerminal(record.state)) return;
      this.fail(record, this.mapFailure(error));
      await this.releaseSessionResource(record);
    }
  }

  private async completeSelection(
    record: OriginalTorrentSessionRecord,
    fileId: number,
  ): Promise<OriginalTorrentSessionSnapshot> {
    try {
      const resource = record.resource;
      const file = record.files?.find((entry) => entry.id === fileId);
      if (
        this.adapter === undefined ||
        resource === undefined ||
        file === undefined
      ) {
        throw new OriginalTorrentSessionConflictError(
          'torrent_file_not_found',
          'The selected file is no longer available to this session.',
        );
      }
      if (resource.lease === undefined) {
        throw new OriginalTorrentSessionConflictError(
          'torrent_file_not_found',
          'The torrent ownership lease is no longer available.',
        );
      }
      await this.adapter.validateLease(resource.lease, {
        signal: record.controller.signal,
      });
      const target = await this.adapter.resolveFileTarget(
        resource.hash,
        fileId,
        {
          signal: record.controller.signal,
        },
      );
      if (isTerminal(record.state)) return snapshot(record);
      if (target.path !== file.path || target.length !== file.length) {
        this.fail(record, {
          code: 'torrent_file_not_found',
          message:
            'The recorded torrent file no longer matches TorrServer metadata.',
          transient: false,
        });
        await this.releaseSessionResource(record);
        return snapshot(record);
      }
      record.selectedFile = file;
      record.target = target;
      this.issueStreamCapability(record);
      this.transition(record, 'ready');
      return snapshot(record);
    } catch (error) {
      if (error instanceof OriginalTorrentSessionConflictError) throw error;
      if (!isTerminal(record.state)) {
        this.fail(record, this.mapFailure(error));
        await this.releaseSessionResource(record);
      }
      return snapshot(record);
    }
  }

  private async acquireResource(
    sessionId: string,
    source: Parameters<OriginalTorrentRuntimeAdapter['add']>[0],
    signal: AbortSignal,
  ): Promise<SharedTorrentResource> {
    while (true) {
      if (signal.aborted) throw readAbortReason(signal);
      const existing = this.resources.get(source.expectedHash);
      if (existing?.closing !== undefined) {
        await raceWithSignal(existing.closing, signal);
        continue;
      }
      if (existing !== undefined) {
        existing.references.add(sessionId);
        this.resourceReferenceCount += 1;
        this.emit({
          event: 'resource_reference',
          outcome: 'success',
          ownership: existing.lease?.ownership,
        });
        return existing;
      }

      const resource: SharedTorrentResource = {
        hash: source.expectedHash,
        source,
        references: new Set([sessionId]),
        phase: 'adding' as const,
        controller: new AbortController(),
        added: false,
        preparation: Promise.resolve(undefined as never),
      };
      resource.preparation = this.prepareResource(resource);
      this.resources.set(resource.hash, resource);
      this.resourceReferenceCount += 1;
      this.emit({ event: 'resource_reference', outcome: 'success' });
      return resource;
    }
  }

  private async prepareResource(
    resource: SharedTorrentResource,
  ): Promise<
    Awaited<ReturnType<OriginalTorrentRuntimeAdapter['waitForMetadata']>>
  > {
    const adapter = this.adapter!;
    const startedAt = this.now();
    try {
      await adapter.health({ signal: resource.controller.signal });
      const added = await adapter.add(resource.source, {
        signal: resource.controller.signal,
      });
      resource.added = true;
      resource.lease = added.lease;
      resource.phase = 'waiting_metadata';
      this.notifyResourcePhase(resource);
      const status =
        added.files.length > 0
          ? added
          : await adapter.waitForMetadata(resource.hash, {
              signal: resource.controller.signal,
            });
      resource.phase = 'ready';
      this.emit({
        event: 'metadata_ready',
        outcome: 'success',
        ownership: resource.lease.ownership,
        durationMs: elapsed(this.now(), startedAt),
        files: status.files.length,
      });
      return status;
    } catch (error) {
      resource.phase = 'failed';
      this.emit({
        event: 'metadata_ready',
        outcome: resource.controller.signal.aborted ? 'cancelled' : 'failure',
        durationMs: elapsed(this.now(), startedAt),
      });
      throw error;
    }
  }

  private notifyResourcePhase(resource: SharedTorrentResource): void {
    for (const sessionId of resource.references) {
      const record = this.sessions.get(sessionId);
      if (record?.state === 'adding') {
        this.transition(record, 'waiting_metadata');
      }
    }
  }

  private async releaseSessionResource(
    record: OriginalTorrentSessionRecord,
  ): Promise<void> {
    if (record.resourceReleased) return;
    record.resourceReleased = true;
    const resource = record.resource;
    if (resource === undefined) return;
    if (resource.references.delete(record.id)) {
      this.resourceReferenceCount -= 1;
    }
    if (resource.references.size === 0) {
      await this.closeResource(resource);
    }
  }

  private async closeResource(resource: SharedTorrentResource): Promise<void> {
    if (resource.closing !== undefined) return resource.closing;
    resource.phase = 'closing';
    resource.controller.abort(
      new Error('No original torrent sessions remain.'),
    );
    resource.closing = (async () => {
      let outcome: 'success' | 'failure' = 'success';
      try {
        await resource.preparation;
      } catch {
        // Preparation failures are reflected on the sessions; cleanup still continues.
      }
      try {
        if (resource.lease !== undefined && this.adapter !== undefined) {
          await this.adapter.release(resource.lease);
        }
      } catch (error) {
        outcome = 'failure';
        throw error;
      } finally {
        if (this.resources.get(resource.hash) === resource) {
          this.resources.delete(resource.hash);
        }
        this.emit({
          event: 'cleanup',
          outcome,
          ownership: resource.lease?.ownership,
        });
      }
    })();
    return resource.closing;
  }

  private async expireIfDue(
    record: OriginalTorrentSessionRecord,
  ): Promise<void> {
    if (!isTerminal(record.state) && this.now() >= record.expiresAtMs) {
      this.makeTerminal(record, 'expired', {
        code: 'session_expired',
        message: 'The original torrent session expired.',
        transient: false,
      });
      record.controller.abort(new Error('Original torrent session expired.'));
      await this.releaseSessionResource(record);
    }
  }

  private fail(
    record: OriginalTorrentSessionRecord,
    error: OriginalTorrentSessionFailure,
  ): void {
    this.makeTerminal(record, 'failed', error);
  }

  private mapFailure(error: unknown): OriginalTorrentSessionFailure {
    const failure = mapSessionFailure(error);
    if (failure.code === 'torrserver_restarted') this.recovered = false;
    return failure;
  }

  private makeTerminal(
    record: OriginalTorrentSessionRecord,
    state: 'failed' | 'stopped' | 'expired',
    error: OriginalTorrentSessionFailure,
  ): void {
    record.state = state;
    record.error = error;
    record.target = undefined;
    this.retireStreamCapability(record, error);
    record.terminalAtMs = this.now();
    this.activeSessionCount -= 1;
    this.touch(record);
    this.emit({
      event: 'session_state',
      state,
      outcome: state === 'failed' ? 'failure' : 'cancelled',
      code: error.code,
    });
  }

  private transition(
    record: OriginalTorrentSessionRecord,
    state: 'waiting_metadata' | 'selection_required' | 'ready',
  ): void {
    record.state = state;
    record.error = undefined;
    this.touch(record);
    this.emit({ event: 'session_state', state, outcome: 'success' });
  }

  private touch(record: OriginalTorrentSessionRecord): void {
    record.updatedAtMs = this.now();
  }

  private requireSession(id: string): OriginalTorrentSessionRecord {
    const record = this.sessions.get(id);
    if (record === undefined) throw new OriginalTorrentSessionNotFoundError();
    return record;
  }

  private allocateSessionId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.createId();
      if (/^[A-Za-z0-9_-]{32}$/u.test(id) && !this.sessions.has(id)) return id;
    }
    throw new Error('Could not allocate a unique bounded torrent session ID.');
  }

  private issueStreamCapability(record: OriginalTorrentSessionRecord): void {
    this.retireStreamCapability(record, {
      code: 'session_expired',
      message: 'The previous stream capability expired.',
      transient: false,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const capability = this.createCapability();
      if (
        /^[A-Za-z0-9_-]{43}$/u.test(capability) &&
        !this.capabilities.has(capability) &&
        !this.retiredCapabilities.has(capability)
      ) {
        record.streamCapability = capability;
        this.capabilities.set(capability, record.id);
        return;
      }
    }
    throw new Error('Could not allocate a unique torrent stream capability.');
  }

  private retireStreamCapability(
    record: OriginalTorrentSessionRecord,
    error: OriginalTorrentSessionFailure,
  ): void {
    const capability = record.streamCapability;
    if (capability === undefined) return;
    this.capabilities.delete(capability);
    this.retiredCapabilities.set(capability, {
      error,
      removeAtMs: this.now() + this.config.terminalRetentionMs,
    });
    record.streamCapability = undefined;
  }

  private ensureRecovered(): Promise<void> {
    if (this.adapter === undefined || this.recovered) {
      return Promise.resolve();
    }
    if (this.recoveryInProgress !== undefined) {
      return this.recoveryInProgress;
    }
    const startedAt = this.now();
    this.recoveryInProgress = this.adapter
      .recoverOwned()
      .then(() => {
        this.recovered = true;
        this.emit({
          event: 'recovery',
          outcome: 'success',
          durationMs: elapsed(this.now(), startedAt),
        });
      })
      .catch((error: unknown) => {
        this.emit({
          event: 'recovery',
          outcome: 'failure',
          durationMs: elapsed(this.now(), startedAt),
        });
        throw error;
      })
      .finally(() => {
        this.recoveryInProgress = undefined;
      });
    return this.recoveryInProgress;
  }

  private emit(
    event: Omit<
      OriginalTorrentSessionTelemetryEvent,
      'activeSessions' | 'activeCreations' | 'resources' | 'references'
    >,
  ): void {
    if (this.report === undefined) return;
    try {
      this.report({
        ...event,
        activeSessions: this.activeSessionCount,
        activeCreations: this.activeCreations,
        resources: this.resources.size,
        references: this.resourceReferenceCount,
      });
    } catch {
      // Telemetry must never change torrent lifecycle behavior.
    }
  }
}

function createRandomSessionId(): string {
  return randomBytes(24).toString('base64url');
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, now - startedAt);
}

function createRandomStreamCapability(): string {
  return randomBytes(32).toString('base64url');
}

function isTerminal(state: OriginalTorrentSessionRecord['state']): boolean {
  return state === 'failed' || state === 'stopped' || state === 'expired';
}

function stateConflict(
  record: OriginalTorrentSessionRecord,
): OriginalTorrentSessionConflictError {
  if (record.state === 'stopped') {
    return new OriginalTorrentSessionConflictError(
      'session_stopped',
      'The original torrent session was stopped.',
    );
  }
  if (record.state === 'expired') {
    return new OriginalTorrentSessionConflictError(
      'session_expired',
      'The original torrent session expired.',
    );
  }
  return new OriginalTorrentSessionConflictError(
    'torrent_file_selection_required',
    'This session is not waiting for a file selection.',
  );
}

function snapshot(
  record: OriginalTorrentSessionRecord,
): OriginalTorrentSessionSnapshot {
  return {
    id: record.id,
    state: record.state,
    observation: { ...record.observation },
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.files === undefined
      ? {}
      : { files: record.files.map((file) => ({ ...file })) }),
    ...(record.selectedFile === undefined
      ? {}
      : { selectedFile: { ...record.selectedFile } }),
    ...(record.streamCapability === undefined
      ? {}
      : {
          streamUrl: `/media/torrent-streams/${record.streamCapability}`,
        }),
    ...(record.error === undefined ? {} : { error: { ...record.error } }),
    createdAt: new Date(record.createdAtMs).toISOString(),
    updatedAt: new Date(record.updatedAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
  };
}

function mapCapabilityErrorCode(
  code: OriginalTorrentSessionFailure['code'],
):
  | 'torrent_pieces_unavailable'
  | 'torrent_stream_failed'
  | 'torrserver_unavailable'
  | 'torrserver_incompatible'
  | 'torrserver_restarted'
  | 'session_stopped'
  | 'session_expired' {
  if (
    code === 'torrent_pieces_unavailable' ||
    code === 'torrent_stream_failed' ||
    code === 'torrserver_unavailable' ||
    code === 'torrserver_incompatible' ||
    code === 'torrserver_restarted' ||
    code === 'session_stopped' ||
    code === 'session_expired'
  ) {
    return code;
  }
  return 'torrent_stream_failed';
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(readAbortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(readAbortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function readAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Original torrent session operation was cancelled.');
}
