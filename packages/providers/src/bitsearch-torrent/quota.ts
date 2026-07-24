import { ProviderError } from "@media-engine/core";

const RATE_LIMIT_HEADER = "x-ratelimit-limit";
const RATE_LIMIT_REMAINING_HEADER = "x-ratelimit-remaining";
const RATE_LIMIT_RESET_HEADER = "x-ratelimit-reset";

export interface BitsearchQuotaGateOptions {
  now?: () => number;
}

// Prevents a provider instance from repeatedly calling the small anonymous daily quota after the
// upstream has reported that it is exhausted. HTTP 429 retry timing is still handled by fetchJson.
export class BitsearchQuotaGate {
  readonly #now: () => number;
  #remaining: number | undefined;
  #resetAt: number | undefined;

  constructor(options: BitsearchQuotaGateOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  observe(response: Response): void {
    const limit = parseNonNegativeInteger(response.headers.get(RATE_LIMIT_HEADER));
    const remaining = parseNonNegativeInteger(response.headers.get(RATE_LIMIT_REMAINING_HEADER));
    const resetAt = parseResetAt(response.headers.get(RATE_LIMIT_RESET_HEADER));

    if (limit === undefined || remaining === undefined || resetAt === undefined) return;
    if (remaining > limit) return;

    this.#remaining = remaining;
    this.#resetAt = resetAt;
  }

  assertAvailable(provider: string): void {
    if (this.#resetAt !== undefined && this.#resetAt <= this.#now()) {
      this.#remaining = undefined;
      this.#resetAt = undefined;
      return;
    }

    if (this.#remaining !== 0 || this.#resetAt === undefined) return;

    throw new ProviderError({
      provider,
      code: "PROVIDER_RATE_LIMITED",
      message: `Provider "${provider}" anonymous quota is exhausted until ${new Date(this.#resetAt).toISOString()}.`,
      retryable: true,
    });
  }
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseResetAt(value: string | null): number | undefined {
  if (!value) return undefined;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
