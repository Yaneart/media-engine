import type { Cache } from "../cache/index.js";
import type { MediaType } from "../media/index.js";
import {
  IDENTITY_NAMESPACES,
  resolveIdentityClaims,
  type IdentityClaim,
  type IdentityDiagnostic,
  type IdentityIds,
  type IdentityResolution,
} from "./model.js";

export interface IdentityResolverSource {
  name: string;
  canResolve(ids: Readonly<IdentityIds>, type: MediaType): boolean;
  resolve(
    ids: Readonly<IdentityIds>,
    type: MediaType,
    signal: AbortSignal,
  ): Promise<readonly IdentityClaim[]>;
}

export interface IdentityResolverOptions {
  cache?: Cache;
  maxPasses?: number;
  maxCalls?: number;
  timeoutMs?: number;
  sourceTimeoutMs?: number;
  cacheTtlMs?: number;
  negativeCacheTtlMs?: number;
}

const DEFAULTS = {
  maxPasses: 3,
  maxCalls: 12,
  timeoutMs: 5_000,
  sourceTimeoutMs: 2_000,
  cacheTtlMs: 60 * 60_000,
  negativeCacheTtlMs: 5 * 60_000,
};

function limit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function keyFor(source: string, type: MediaType, ids: IdentityIds): string {
  const pairs = IDENTITY_NAMESPACES.flatMap((namespace) =>
    ids[namespace] ? [[namespace, ids[namespace]]] : [],
  );
  return `identity:resolver:${JSON.stringify([source, type, pairs])}`;
}

function abortError(): Error {
  return Object.assign(new Error("Identity resolution cancelled"), { name: "AbortError" });
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function validClaims(value: unknown): value is readonly IdentityClaim[] {
  return (
    Array.isArray(value) &&
    value.every(
      (claim) =>
        claim &&
        typeof claim === "object" &&
        claim.matched &&
        typeof claim.matched === "object" &&
        claim.ids &&
        typeof claim.ids === "object" &&
        !Array.isArray(claim.ids),
    )
  );
}

export class IdentityResolver {
  private readonly inFlight = new Map<string, Promise<readonly IdentityClaim[]>>();
  private readonly options: Required<Omit<IdentityResolverOptions, "cache">>;
  private readonly cache?: Cache;

  constructor(
    private readonly sources: readonly IdentityResolverSource[],
    options: IdentityResolverOptions = {},
  ) {
    this.cache = options.cache;
    this.options = {
      maxPasses: limit(options.maxPasses, DEFAULTS.maxPasses),
      maxCalls: limit(options.maxCalls, DEFAULTS.maxCalls),
      timeoutMs: limit(options.timeoutMs, DEFAULTS.timeoutMs),
      sourceTimeoutMs: limit(options.sourceTimeoutMs, DEFAULTS.sourceTimeoutMs),
      cacheTtlMs: limit(options.cacheTtlMs, DEFAULTS.cacheTtlMs),
      negativeCacheTtlMs: limit(options.negativeCacheTtlMs, DEFAULTS.negativeCacheTtlMs),
    };
    if (new Set(sources.map((source) => source.name)).size !== sources.length)
      throw new Error("Identity resolver source names must be unique");
  }

  private async fetch(
    source: IdentityResolverSource,
    ids: IdentityIds,
    type: MediaType,
    deadline: number,
  ): Promise<readonly IdentityClaim[]> {
    const key = keyFor(source.name, type, ids);
    let cached: readonly IdentityClaim[] | undefined;
    try {
      if (this.cache) {
        let timer: ReturnType<typeof setTimeout>;
        try {
          cached = await Promise.race([
            this.cache.get<readonly IdentityClaim[]>(key),
            new Promise<undefined>((resolve) => {
              timer = setTimeout(() => resolve(undefined), Math.max(1, deadline - Date.now()));
            }),
          ]);
        } finally {
          clearTimeout(timer!);
        }
      }
    } catch {
      // A cache outage must not suppress a source lookup.
    }
    if (validClaims(cached)) return cached.map((claim) => ({ ...claim, source: source.name }));
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const controller = new AbortController();
    const duration = Math.max(1, Math.min(this.options.sourceTimeoutMs, deadline - Date.now()));
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error("Identity source timed out"), { name: "TimeoutError" }));
      }, duration);
    });
    const request = Promise.resolve().then(() =>
      source.resolve({ ...ids }, type, controller.signal),
    );
    const task = Promise.race([request, timeout]).then(async (claims) => {
      if (!validClaims(claims)) throw new Error("Identity source returned invalid claims");
      const bound = claims.map((claim) => ({ ...claim, source: source.name }));
      try {
        void Promise.resolve(
          this.cache?.set(key, bound, {
            ttlMs: claims.length ? this.options.cacheTtlMs : this.options.negativeCacheTtlMs,
          }),
        ).catch(() => {});
      } catch {
        // Resolution remains valid without a cached copy.
      }
      return bound;
    });
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      clearTimeout(timer!);
      this.inFlight.delete(key);
    }
  }

  async resolve(
    type: MediaType,
    initial: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<IdentityResolution> {
    let result = resolveIdentityClaims(type, initial, []);
    const original = result.ids;
    const diagnostics: IdentityDiagnostic[] = [...result.diagnostics];
    const claims: IdentityClaim[] = [];
    const claimKeys = new Set<string>();
    const ambiguous = new Set<string>();
    const attempted = new Set<string>();
    const deadline = Date.now() + this.options.timeoutMs;
    let calls = 0;

    for (let pass = 0; pass < this.options.maxPasses; pass++) {
      if (signal?.aborted) {
        diagnostics.push({ code: "CANCELLED" });
        break;
      }
      if (Date.now() >= deadline || calls >= this.options.maxCalls) {
        diagnostics.push({ code: "BUDGET_EXHAUSTED" });
        break;
      }
      const snapshot = { ...result.ids };
      const applicable = this.sources.filter((source) => {
        try {
          return (
            source.canResolve(snapshot, type) && !attempted.has(keyFor(source.name, type, snapshot))
          );
        } catch {
          diagnostics.push({ code: "SOURCE_ERROR", source: source.name });
          return false;
        }
      });
      const selected = applicable.slice(0, this.options.maxCalls - calls);
      if (selected.length < applicable.length) diagnostics.push({ code: "BUDGET_EXHAUSTED" });
      if (!selected.length) break;
      calls += selected.length;
      const batches = await Promise.all(
        selected.map(async (source) => {
          attempted.add(keyFor(source.name, type, snapshot));
          try {
            return await waitFor(this.fetch(source, snapshot, type, deadline), signal);
          } catch (error) {
            diagnostics.push({
              code: signal?.aborted
                ? "CANCELLED"
                : error instanceof Error && error.name === "TimeoutError"
                  ? "SOURCE_TIMEOUT"
                  : "SOURCE_ERROR",
              source: source.name,
            });
            return [];
          }
        }),
      );
      if (signal?.aborted) break;
      for (const claim of batches.flat()) {
        const key = JSON.stringify(claim);
        if (!claimKeys.has(key)) {
          claimKeys.add(key);
          claims.push(claim);
        }
      }
      const next = resolveIdentityClaims(type, { ...original }, claims, snapshot);
      diagnostics.push(...next.diagnostics);
      for (const item of next.diagnostics)
        if (item.code === "AMBIGUOUS_ID" && item.namespace) ambiguous.add(item.namespace);
      for (const namespace of IDENTITY_NAMESPACES)
        if (ambiguous.has(namespace) && !original[namespace]) delete next.ids[namespace];
      next.provenance = next.provenance.filter(
        (entry) => next.ids[entry.namespace] === entry.value,
      );
      const changed = IDENTITY_NAMESPACES.some(
        (namespace) => next.ids[namespace] !== snapshot[namespace],
      );
      result = next;
      if (!changed) break;
      if (pass === this.options.maxPasses - 1) diagnostics.push({ code: "BUDGET_EXHAUSTED" });
    }
    return { ...result, diagnostics };
  }
}
