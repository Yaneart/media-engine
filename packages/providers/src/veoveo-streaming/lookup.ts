import { ProviderError, type ProviderContext } from "@media-engine/core";
import { rethrowIfProviderAborted } from "../shared/abort.js";
import { fetchJson, mapHttpResponseToProviderError } from "../shared/http.js";
import { readBoundedResponseText } from "../shared/response-body.js";
import type { VeoVeoLookup } from "./client.js";
import type { VeoVeoStreamingConfig } from "./config.js";

export function createLookupUrl(baseUrl: string, lookup: VeoVeoLookup): URL {
  const url = new URL("/balancer-api/iframe", `${baseUrl}/`);
  url.searchParams.set(lookup.source === "kinopoisk" ? "kp" : "imdb", lookup.id);
  return url;
}

export function parseVeoVeoContentId(provider: string, html: string): string | undefined {
  const assignments = [...html.matchAll(/\bwindow\.MOVIE_ID\s*=\s*([^;\r\n]+)\s*;/gu)];
  if (assignments.length === 0) return undefined;
  const ids = assignments.map((match) => match[1]!.trim());
  if (ids.some((id) => !/^[1-9]\d{0,11}$/u.test(id)) || new Set(ids).size !== 1) {
    throw new ProviderError({
      provider,
      code: "PROVIDER_INVALID_RESPONSE",
      message: `Provider "${provider}" returned an ambiguous VeoVeo content ID.`,
      retryable: false,
    });
  }
  return ids[0];
}

export async function lookupVeoVeoContentId(
  config: VeoVeoStreamingConfig,
  lookup: VeoVeoLookup,
  context: ProviderContext,
): Promise<{ contentId: string; sourceUrl: string } | null> {
  rethrowIfProviderAborted(context, new Error("VeoVeo lookup cancelled."));
  if (!config.apiKey) {
    throw new ProviderError({
      provider: config.name,
      code: "PROVIDER_UNAUTHORIZED",
      message: `Provider "${config.name}" requires a provider-issued VeoVeo apiKey.`,
      retryable: false,
    });
  }
  const sourceUrl = createLookupUrl(config.lookupBaseUrl, lookup);
  const url = new URL(sourceUrl);
  url.searchParams.set("token", config.apiKey);
  const timeout = AbortSignal.timeout(
    context.timeoutMs && context.timeoutMs > 0 ? context.timeoutMs : 5_000,
  );
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
  try {
    await config.rateLimitGate.wait(signal);
    const response = await config.fetch(url, {
      signal,
      headers: { Accept: "text/html", "User-Agent": config.userAgent },
    });
    let html: string;
    try {
      if (!response.ok) throw mapHttpResponseToProviderError(config.name, response);
      html = await readBoundedResponseText(config.name, response, config.maxLookupResponseBytes, {
        signal,
      });
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
    const contentId = parseVeoVeoContentId(config.name, html);
    if (!contentId) return null;

    // Confirm the external ID on VeoVeo itself before accepting its internal content ID.
    const detailsUrl = new URL(
      `/balancer-api/proxy/playlists/catalog-api/contents/${contentId}`,
      `${config.streamBaseUrl}/`,
    );
    const details = await fetchJson<Record<string, unknown>>({
      provider: config.name,
      url: detailsUrl,
      context: { ...context, signal, timeoutMs: undefined },
      fetch: config.fetch,
      rateLimitGate: config.rateLimitGate,
      maxRetries: 0,
      maxResponseBytes: config.maxLookupResponseBytes,
      init: { headers: { Accept: "application/json", "User-Agent": config.userAgent } },
    });
    const field = lookup.source === "kinopoisk" ? "kinopoiskId" : "imdbId";
    if (
      !details ||
      Array.isArray(details) ||
      String(details.id) !== contentId ||
      String(details[field]) !== lookup.id
    )
      return null;
    return { contentId, sourceUrl: sourceUrl.href };
  } catch (error) {
    rethrowIfProviderAborted(context, error);
    const code =
      error instanceof ProviderError
        ? error.code
        : signal.aborted
          ? "PROVIDER_TIMEOUT"
          : "PROVIDER_UNAVAILABLE";
    throw new ProviderError({
      provider: config.name,
      code,
      retryable: error instanceof ProviderError ? error.retryable : true,
      message: `Provider "${config.name}" VeoVeo lookup failed (${code}).`,
    });
  }
}
