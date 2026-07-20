import { EventEmitter } from 'node:events';
import { runWithHttpRequestSignal } from './request-cancellation';

class RequestLifecycle extends EventEmitter {
  aborted = false;
  complete = true;
}

class ResponseLifecycle extends EventEmitter {
  writableEnded = false;
}

describe('runWithHttpRequestSignal', () => {
  it('aborts work when the response connection closes early', async () => {
    const request = new RequestLifecycle();
    const response = new ResponseLifecycle();
    let receivedSignal: AbortSignal | undefined;
    const pending = runWithHttpRequestSignal(
      request,
      response,
      async (signal) => {
        receivedSignal = signal;
        return new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );

    response.emit('close');

    await expect(pending).resolves.toBeUndefined();
    expect(receivedSignal?.aborted).toBe(true);
    expect(request.listenerCount('aborted')).toBe(0);
    expect(request.listenerCount('close')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('uses request aborted and incomplete close events but ignores a completed request close', async () => {
    const request = new RequestLifecycle();
    const response = new ResponseLifecycle();
    let resolveOperation: ((value: string) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const pending = runWithHttpRequestSignal(
      request,
      response,
      async (signal) => {
        receivedSignal = signal;
        return new Promise<string>((resolve) => {
          resolveOperation = resolve;
        });
      },
    );

    request.emit('close');
    expect(receivedSignal?.aborted).toBe(false);

    request.aborted = true;
    request.emit('aborted');
    expect(receivedSignal?.aborted).toBe(true);
    resolveOperation?.('done');
    await expect(pending).resolves.toBe('done');
  });

  it('aborts work when an incomplete request emits close', async () => {
    const request = new RequestLifecycle();
    const response = new ResponseLifecycle();
    request.complete = false;
    const pending = runWithHttpRequestSignal(
      request,
      response,
      async (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    request.emit('close');

    await expect(pending).resolves.toBeUndefined();
  });

  it('removes every listener after a normal operation', async () => {
    const request = new RequestLifecycle();
    const response = new ResponseLifecycle();
    response.writableEnded = true;

    await expect(
      runWithHttpRequestSignal(request, response, async (signal) => {
        expect(signal.aborted).toBe(false);
        return 'done';
      }),
    ).resolves.toBe('done');

    expect(request.listenerCount('aborted')).toBe(0);
    expect(request.listenerCount('close')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });
});
