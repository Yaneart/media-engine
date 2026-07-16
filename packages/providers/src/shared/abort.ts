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
