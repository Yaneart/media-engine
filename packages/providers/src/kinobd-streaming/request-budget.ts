import { ProviderError, type ProviderContext } from "@media-engine/core";
import type { ProviderFetch } from "../shared/index.js";

export interface KinoBdRequestReservation {
  timeoutMs?: number;
}

// Shares a fixed request-count and wall-time budget across one availability operation.
// Делит фиксированный бюджет запросов и wall time внутри одной availability operation.
export class KinoBdRequestBudget {
  readonly #deadline: number | undefined;
  #remainingRequests: number;
  #usedRequests = 0;

  constructor(
    context: ProviderContext,
    requestLimit: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#remainingRequests = requestLimit;
    this.#deadline =
      context.timeoutMs === undefined ? undefined : this.now() + Math.max(0, context.timeoutMs);
  }

  get usedRequests(): number {
    return this.#usedRequests;
  }

  createFetch(provider: string, fetchOverride?: ProviderFetch): ProviderFetch {
    const fetchImpl = fetchOverride ?? fetch;

    return async (input, init) => {
      if (!this.reserve()) {
        throw new ProviderError({
          provider,
          code: "PROVIDER_TIMEOUT",
          message: `Provider "${provider}" exhausted its child request budget.`,
          retryable: true,
        });
      }

      return fetchImpl(input, init);
    };
  }

  reserve(minimumRemainingMs = 1): KinoBdRequestReservation | undefined {
    if (this.#remainingRequests <= 0) {
      return undefined;
    }

    const timeoutMs = this.getRemainingTimeMs();

    if (timeoutMs !== undefined && timeoutMs < minimumRemainingMs) {
      return undefined;
    }

    this.#remainingRequests -= 1;
    this.#usedRequests += 1;

    return timeoutMs === undefined ? {} : { timeoutMs };
  }

  createContext(context: ProviderContext, callTimeoutMs?: number): ProviderContext {
    const timeoutMs = minDefined(this.getRemainingTimeMs(), callTimeoutMs);

    return timeoutMs === undefined ? { ...context } : { ...context, timeoutMs };
  }

  private getRemainingTimeMs(): number | undefined {
    return this.#deadline === undefined ? undefined : Math.max(0, this.#deadline - this.now());
  }
}

function minDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  return Math.min(left, right);
}
