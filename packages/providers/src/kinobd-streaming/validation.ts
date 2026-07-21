import type { MediaAvailability, ProviderContext, StreamOption } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { readBoundedResponseText } from "../shared/response-body.js";
import type {
  KinoBdFilteredPlayerAuditEntry,
  KinoBdPlayerAuditMetrics,
  KinoBdStreamingConfig,
} from "./config.js";
import { normalizeSearchText } from "./candidates.js";
import { extractIframeUrl } from "./players.js";
import type { KinoBdRequestBudget, KinoBdRequestReservation } from "./request-budget.js";

const PLAYER_VALIDATION_MAX_DEPTH = 1;
const PLAYER_VALIDATION_MAX_BODY_BYTES = 256 * 1024;

interface PlayerOptionFilterResult {
  options: StreamOption[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
  metrics: Omit<KinoBdPlayerAuditMetrics, "discovered" | "childRequests">;
}

type PlayerValidationOutcome = "available" | "broken" | "unknown";

interface PlayerValidationResult {
  outcome: PlayerValidationOutcome;
  started: boolean;
  skippedByBudget: boolean;
}

export async function filterBrokenPlayerOptions(
  config: KinoBdStreamingConfig,
  options: StreamOption[],
  context: ProviderContext,
  budget: KinoBdRequestBudget,
): Promise<PlayerOptionFilterResult> {
  const knownBrokenOptions = options.filter((option) => isKnownBrokenPlayerUrl(option.access.url));
  const optionsWithoutKnownBrokenUrls = options.filter(
    (option) => !knownBrokenOptions.includes(option),
  );
  const optionsToValidate = optionsWithoutKnownBrokenUrls.slice(0, config.playerValidationLimit);
  const optionsSkippedByLimit = optionsWithoutKnownBrokenUrls.slice(config.playerValidationLimit);
  const checks = await mapWithConcurrency(
    optionsToValidate,
    config.playerValidationConcurrency,
    async (option) => ({
      option,
      result: await validatePlayerOption(config, option.access.url, context, budget),
    }),
  );
  const retainedChecks = checks.filter((check) => check.result.outcome !== "broken");

  return {
    options: [
      ...retainedChecks.map((check) =>
        check.result.outcome === "unknown"
          ? { ...check.option, availability: "unknown" as const }
          : check.option,
      ),
      ...optionsSkippedByLimit,
    ],
    filtered: [
      ...knownBrokenOptions.map((option) => ({
        player: option.player.label,
        reason: "known_broken_url" as const,
        url: option.access.url,
      })),
      ...checks
        .filter((check) => check.result.outcome === "broken")
        .map((check) => ({
          player: check.option.player.label,
          reason: "player_validation_failed" as const,
          url: check.option.access.url,
        })),
    ],
    metrics: {
      validated: checks.filter((check) => check.result.started).length,
      skippedByLimit: optionsSkippedByLimit.length,
      skippedByBudget: checks.filter((check) => check.result.skippedByBudget).length,
      transientUnknown: checks.filter((check) => check.result.outcome === "unknown").length,
      removedConfirmed:
        knownBrokenOptions.length +
        checks.filter((check) => check.result.outcome === "broken").length,
    },
  };
}

export function emitPlayerAudit(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  discovered: string[],
  shown: StreamOption[],
  filtered: KinoBdFilteredPlayerAuditEntry[],
  validationMetrics: Omit<KinoBdPlayerAuditMetrics, "discovered" | "childRequests"> | undefined,
  budget: KinoBdRequestBudget,
): void {
  try {
    const uniqueDiscovered = [...new Set(discovered)];

    config.onPlayerAudit?.({
      query: {
        ...query,
        ...(query.ids ? { ids: { ...query.ids } } : {}),
        ...(query.providers ? { providers: [...query.providers] } : {}),
      },
      discovered: uniqueDiscovered,
      shown: [...new Set(shown.map((option) => option.player.label))],
      filtered,
      metrics: {
        discovered: uniqueDiscovered.length,
        validated: validationMetrics?.validated ?? 0,
        skippedByLimit: validationMetrics?.skippedByLimit ?? 0,
        skippedByBudget: validationMetrics?.skippedByBudget ?? 0,
        transientUnknown:
          validationMetrics?.transientUnknown ??
          shown.filter((option) => option.availability === "unknown").length,
        removedConfirmed:
          validationMetrics?.removedConfirmed ??
          filtered.filter(
            (entry) =>
              entry.reason === "known_broken_url" || entry.reason === "player_validation_failed",
          ).length,
        childRequests: budget.usedRequests,
      },
    });
  } catch {
    // Diagnostics must not change availability behavior.
  }
}

async function validatePlayerOption(
  config: KinoBdStreamingConfig,
  url: string,
  context: ProviderContext,
  budget: KinoBdRequestBudget,
): Promise<PlayerValidationResult> {
  const reservation = budget.reserve();

  if (!reservation) {
    return { outcome: "unknown", started: false, skippedByBudget: true };
  }

  const result = await validatePlayerUrl(config, url, context, budget, reservation);

  return { ...result, started: true };
}

async function validatePlayerUrl(
  config: KinoBdStreamingConfig,
  url: string,
  context: ProviderContext,
  budget: KinoBdRequestBudget,
  reservation: KinoBdRequestReservation,
  depth = 0,
): Promise<Omit<PlayerValidationResult, "started">> {
  const fetchImpl = config.externalFetch;
  const controller = new AbortController();
  const timeoutMs = Math.min(
    config.playerValidationTimeoutMs,
    reservation.timeoutMs ?? config.playerValidationTimeoutMs,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;

  try {
    if (context.signal?.aborted) {
      throw context.signal.reason;
    }

    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal,
    });

    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return { outcome: "broken", skippedByBudget: false };
    }

    if (!response.ok) {
      await response.body?.cancel();
      return { outcome: "unknown", skippedByBudget: false };
    }

    const html = await readBoundedResponseText(
      config.name,
      response,
      PLAYER_VALIDATION_MAX_BODY_BYTES,
      { signal, overflow: "truncate" },
    );

    if (hasBrokenPlayerMarker(html)) {
      return { outcome: "broken", skippedByBudget: false };
    }

    const nestedUrl = depth < PLAYER_VALIDATION_MAX_DEPTH ? extractIframeUrl(html, url) : undefined;

    if (!nestedUrl) {
      return { outcome: "available", skippedByBudget: false };
    }

    // Nested validation is optional and starts only when the operation can still grant
    // a full validation window as well as one child-request slot.
    // Вложенная проверка запускается только при полном временном окне и свободном request slot.
    const nestedReservation = budget.reserve(config.playerValidationTimeoutMs);

    if (!nestedReservation) {
      return { outcome: "unknown", skippedByBudget: true };
    }

    return validatePlayerUrl(config, nestedUrl, context, budget, nestedReservation, depth + 1);
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    return {
      outcome: isKnownBrokenPlayerUrl(url) ? "broken" : "unknown",
      skippedByBudget: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));

  return results;
}

function isKnownBrokenPlayerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      /(^|\.)sevstar\d*krop\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/iframe")
    );
  } catch {
    return false;
  }
}

function hasBrokenPlayerMarker(html: string): boolean {
  const normalized = normalizeSearchText(html);

  return (
    normalized.includes("video not found") ||
    normalized.includes("404 not found") ||
    normalized.includes("плеер недоступ") ||
    normalized.includes("плеєр недоступ") ||
    normalized.includes("недоступний для перегляду") ||
    normalized.includes("змініть країну перегляду")
  );
}
