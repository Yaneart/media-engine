import {
  serializeRuntimeEvent,
  serializeSessionEvent,
  serializeStreamEvent,
} from './observability.service';

describe('original torrent observability redaction', () => {
  it('serializes only bounded allowlisted fields', () => {
    const secret = {
      hash: 'a'.repeat(40),
      capability: 'C'.repeat(43),
      url: 'http://user:password@torrserver:8090/private',
      title: 'Secret title',
      payload: 'magnet:?xt=urn:btih:secret',
    };
    const records = [
      serializeRuntimeEvent({
        operation: 'metadata',
        outcome: 'failure',
        code: 'metadata_timeout',
        transient: true,
        durationMs: 500,
        ...secret,
      }),
      serializeSessionEvent({
        event: 'metadata_ready',
        outcome: 'success',
        ownership: 'application',
        durationMs: 250,
        activeSessions: 2,
        activeCreations: 1,
        resources: 1,
        references: 2,
        files: 3,
        ...secret,
      }),
      serializeStreamEvent({
        event: 'first_byte',
        outcome: 'success',
        method: 'GET',
        range: 'partial',
        rangeStart: 1_024,
        rangeEnd: 2_047,
        durationMs: 120,
        upstreamWaitMs: 100,
        activeStreams: 1,
        ...secret,
      }),
    ];
    const serialized = JSON.stringify(records);

    expect(serialized).not.toContain(secret.hash);
    expect(serialized).not.toContain(secret.capability);
    expect(serialized).not.toContain(secret.url);
    expect(serialized).not.toContain(secret.title);
    expect(serialized).not.toContain(secret.payload);
    expect(records).toEqual([
      {
        component: 'original_torrent',
        scope: 'runtime',
        event: 'operation',
        operation: 'metadata',
        outcome: 'failure',
        code: 'metadata_timeout',
        transient: true,
        durationMs: 500,
      },
      {
        component: 'original_torrent',
        scope: 'session',
        event: 'metadata_ready',
        outcome: 'success',
        ownership: 'application',
        durationMs: 250,
        activeSessions: 2,
        activeCreations: 1,
        resources: 1,
        references: 2,
        files: 3,
      },
      {
        component: 'original_torrent',
        scope: 'stream',
        event: 'first_byte',
        outcome: 'success',
        method: 'GET',
        range: 'partial',
        rangeStart: 1024,
        rangeEnd: 2047,
        durationMs: 120,
        upstreamWaitMs: 100,
        activeStreams: 1,
      },
    ]);
  });
});
