import type { ProviderContext } from "@media-engine/core";

// Preserves caller cancellation while optional provider work handles ordinary failures softly.
// Сохраняет отмену вызывающей стороны, пока optional provider work мягко обрабатывает обычные сбои.
export function rethrowIfProviderAborted(
  context: Pick<ProviderContext, "signal">,
  error: unknown,
): void {
  if (context.signal?.aborted) {
    throw context.signal.reason ?? error;
  }
}

// Waits without losing caller cancellation and removes the listener on normal completion.
// Ждёт с поддержкой отмены caller и удаляет listener после обычного завершения.
export function waitForAbortableDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (milliseconds <= 0) {
    return signal?.aborted ? Promise.reject(signal.reason) : Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
