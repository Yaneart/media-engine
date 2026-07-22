import type { ProviderContext, StreamOption } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { readBoundedResponseText } from "../shared/response-body.js";
import type { DdbbStreamingConfig } from "./config.js";

type PlayerValidationOutcome = "available" | "unavailable" | "unknown";

export async function filterDdbbPlayerOptions(
  config: DdbbStreamingConfig,
  options: StreamOption[],
  context: ProviderContext,
): Promise<StreamOption[]> {
  const optionsToValidate = options.slice(0, config.playerValidationLimit);
  const optionsSkippedByLimit = options.slice(config.playerValidationLimit);
  const checks = await mapWithConcurrency(
    optionsToValidate,
    config.playerValidationConcurrency,
    async (option) => ({
      option,
      outcome: await validatePlayer(config, option.access.url, context),
    }),
  );

  return [
    ...checks
      .filter((check) => check.outcome !== "unavailable")
      .map((check) =>
        check.outcome === "unknown"
          ? { ...check.option, availability: "unknown" as const }
          : check.option,
      ),
    ...optionsSkippedByLimit,
  ];
}

async function validatePlayer(
  config: DdbbStreamingConfig,
  url: string,
  context: ProviderContext,
): Promise<PlayerValidationOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.playerValidationTimeoutMs);
  const signal = context.signal
    ? AbortSignal.any([context.signal, controller.signal])
    : controller.signal;

  try {
    if (context.signal?.aborted) throw context.signal.reason;

    const response = await config.externalFetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: `${config.baseUrl}/`,
        "User-Agent": config.userAgent,
      },
      signal,
    });

    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return "unavailable";
    }

    if (!response.ok) {
      await response.body?.cancel();
      return "unknown";
    }

    const html = await readBoundedResponseText(
      config.name,
      response,
      config.playerValidationMaxBytes,
      { signal, overflow: "truncate" },
    );
    return hasUnavailableMarker(html) ? "unavailable" : "available";
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

function hasUnavailableMarker(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  return (
    normalized.includes("video not found") ||
    normalized.includes("file was deleted") ||
    normalized.includes("file has been deleted") ||
    normalized.includes("video is unavailable") ||
    normalized.includes("404 not found") ||
    normalized.includes("плеер недоступ") ||
    normalized.includes("видео недоступ")
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => worker()),
  );
  return results;
}
