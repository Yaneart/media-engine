// Shares one timeout deadline across all calls to a provider in one engine operation.
// Делит один timeout deadline между всеми вызовами провайдера в одной операции движка.
export class ProviderTimeoutBudget {
  private readonly deadlines = new Map<string, number>();

  constructor(
    private readonly resolveTimeoutMs: (provider: string) => number | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  getRemainingMs(provider: string, callLimitMs?: number): number | undefined {
    const now = this.now();
    const existingDeadline = this.deadlines.get(provider);

    if (existingDeadline !== undefined) {
      return applyCallLimit(Math.max(0, existingDeadline - now), callLimitMs);
    }

    const timeoutMs = this.resolveTimeoutMs(provider);
    const initialBudget = applyCallLimit(timeoutMs, callLimitMs);

    if (initialBudget !== undefined) {
      this.deadlines.set(provider, now + initialBudget);
    }

    return initialBudget;
  }
}

function applyCallLimit(
  timeoutMs: number | undefined,
  callLimitMs: number | undefined,
): number | undefined {
  if (timeoutMs === undefined) {
    return callLimitMs;
  }

  return callLimitMs === undefined ? timeoutMs : Math.min(timeoutMs, callLimitMs);
}
