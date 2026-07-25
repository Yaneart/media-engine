import { ReferencePlaybackRuntime } from './runtime';

describe('ReferencePlaybackRuntime', () => {
  const token = 'operator-token-that-is-at-least-32-characters';

  it('authenticates only the exact bearer token without exposing it', () => {
    const runtime = new ReferencePlaybackRuntime(
      { health: jest.fn() },
      { enabled: true, token },
    );

    expect(runtime.enabled).toBe(true);
    expect(runtime.authorizeBearer(`Bearer ${token}`)).toBe(true);
    expect(runtime.authorizeBearer(`bearer ${token}`)).toBe(true);
    expect(runtime.authorizeBearer(`Bearer ${token}extra`)).toBe(false);
    expect(runtime.authorizeBearer(token)).toBe(false);
    expect(runtime.authorizeBearer(undefined)).toBe(false);
    expect(JSON.stringify(runtime)).not.toContain(token);
  });

  it('reports disabled, healthy, and unavailable states without target details', async () => {
    const disabled = new ReferencePlaybackRuntime(undefined, {
      enabled: false,
    });
    expect(await disabled.health()).toEqual({ status: 'disabled' });

    const client = {
      health: jest.fn().mockResolvedValue({ version: '141.1' }),
    };
    const healthy = new ReferencePlaybackRuntime(client, {
      enabled: true,
      token,
    });
    const signal = new AbortController().signal;
    expect(await healthy.health({ signal })).toEqual({
      status: 'ok',
      version: '141.1',
    });
    expect(client.health.mock.calls).toEqual([[{ signal }]]);

    client.health.mockRejectedValueOnce(new Error('http://secret.internal'));
    expect(await healthy.health()).toEqual({ status: 'unavailable' });
  });
});
