import type { MediaAvailability, ProviderContext, StreamOption } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import type { KinoBdFilteredPlayerAuditEntry, KinoBdStreamingConfig } from "./config.js";
import { normalizeSearchText } from "./candidates.js";
import { extractIframeUrl } from "./players.js";

const PLAYER_VALIDATION_MAX_DEPTH = 1;
const PLAYER_VALIDATION_MAX_BODY_BYTES = 256 * 1024;

interface PlayerOptionFilterResult {
  options: StreamOption[];
  filtered: KinoBdFilteredPlayerAuditEntry[];
}

type PlayerValidationOutcome = "available" | "broken" | "unknown";

export async function filterBrokenPlayerOptions(
  config: KinoBdStreamingConfig,
  options: StreamOption[],
  context: ProviderContext,
): Promise<PlayerOptionFilterResult> {
  const knownBrokenOptions = options.filter((option) => isKnownBrokenPlayerUrl(option.access.url));
  const optionsWithoutKnownBrokenUrls = options.filter(
    (option) => !knownBrokenOptions.includes(option),
  );
  const optionsToValidate = optionsWithoutKnownBrokenUrls.slice(0, config.playerValidationLimit);
  const optionsSkippedByLimit = optionsWithoutKnownBrokenUrls.slice(config.playerValidationLimit);
  const checks = await Promise.all(
    optionsToValidate.map(async (option) => ({
      option,
      outcome: await validatePlayerUrl(config, option.access.url, context),
    })),
  );

  return {
    options: [
      ...checks
        .filter((check) => check.outcome !== "broken")
        .map((check) =>
          check.outcome === "unknown"
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
        .filter((check) => check.outcome === "broken")
        .map((check) => ({
          player: check.option.player.label,
          reason: "player_validation_failed" as const,
          url: check.option.access.url,
        })),
    ],
  };
}

export function emitPlayerAudit(
  config: KinoBdStreamingConfig,
  query: MediaAvailability["query"],
  discovered: string[],
  shown: StreamOption[],
  filtered: KinoBdFilteredPlayerAuditEntry[],
): void {
  try {
    config.onPlayerAudit?.({
      query: {
        ...query,
        ...(query.ids ? { ids: { ...query.ids } } : {}),
        ...(query.providers ? { providers: [...query.providers] } : {}),
      },
      discovered: [...new Set(discovered)],
      shown: [...new Set(shown.map((option) => option.player.label))],
      filtered,
    });
  } catch {
    // Diagnostics must not change availability behavior.
  }
}

async function validatePlayerUrl(
  config: KinoBdStreamingConfig,
  url: string,
  context: ProviderContext,
  depth = 0,
): Promise<PlayerValidationOutcome> {
  const fetchImpl = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.playerValidationTimeoutMs);
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
      return "broken";
    }

    if (!response.ok) {
      await response.body?.cancel();
      return "unknown";
    }

    const html = await readBoundedResponseText(response, PLAYER_VALIDATION_MAX_BODY_BYTES);

    if (hasBrokenPlayerMarker(html)) {
      return "broken";
    }

    const nestedUrl = depth < PLAYER_VALIDATION_MAX_DEPTH ? extractIframeUrl(html, url) : undefined;

    return nestedUrl ? validatePlayerUrl(config, nestedUrl, context, depth + 1) : "available";
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    return isKnownBrokenPlayerUrl(url) ? "broken" : "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes <= maxBytes) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        break;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
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
