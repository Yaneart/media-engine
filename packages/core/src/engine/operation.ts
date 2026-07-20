// Internal cancellation used only when every subscriber has left a shared engine operation.
// Внутренняя отмена, используемая только когда shared operation лишилась всех подписчиков.
export class OperationCancelledError extends Error {
  constructor() {
    super("Media Engine operation was cancelled because it has no active subscribers.");
    this.name = "AbortError";
  }
}

export function isOperationCancelledError(error: unknown): error is OperationCancelledError {
  return error instanceof OperationCancelledError;
}

export function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? createAbortError();
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

// Lets callers stop waiting for non-cancellable cache adapters without changing their contract.
// Позволяет caller прекратить ожидание cache adapter без изменения его контракта.
export function waitForCaller<T>(
  value: PromiseLike<T> | T,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return Promise.resolve(value);
  }

  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(getAbortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
  });
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
