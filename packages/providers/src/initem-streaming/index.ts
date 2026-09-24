import { ProviderError, type MediaAvailability, type StreamingProvider } from "@media-engine/core";
import { normalizeProviderOutputUrl, type ProviderFetch } from "../shared/index.js";
import { readBoundedResponseText } from "../shared/response-body.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";

const KINOPOISK_ID = /^[1-9]\d{0,11}$/u;
const IMDB_ID = /^tt\d{2,12}$/u;

export interface InitemStreamingProviderOptions {
  baseUrl?: string;
  fetch?: ProviderFetch;
}

export function initemStreamingProvider(
  options: InitemStreamingProviderOptions = {},
): StreamingProvider {
  const name = "initem-streaming";
  const base = new URL(options.baseUrl ?? "https://api.initem.ws");
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new TypeError("Initem base URL must be credential-free HTTPS.");
  }
  const fetchImpl =
    options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 2 });

  return {
    name,
    kind: "streaming",
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      lookup: { byTitle: false, byExternalIds: ["kinopoisk", "imdb"], byEpisode: false },
      features: ["embed", "translations"],
    },
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(name)) return null;
      if (
        query.seasonNumber !== undefined ||
        query.episodeNumber !== undefined ||
        query.absoluteEpisodeNumber !== undefined
      )
        return null;
      const kinopoiskId = query.ids?.kinopoisk ?? query.kinopoisk;
      const imdbId = query.ids?.imdb ?? query.imdb;
      const lookup =
        kinopoiskId && KINOPOISK_ID.test(kinopoiskId)
          ? { source: "kp", id: kinopoiskId }
          : imdbId && IMDB_ID.test(imdbId)
            ? { source: "imdb", id: imdbId }
            : null;
      if (!lookup) return null;

      const embedUrl = normalizeProviderOutputUrl(
        new URL(`/embed/${lookup.source}/${lookup.id}`, base).href,
      );
      if (!embedUrl) throw invalidResponse(name);
      const response = await fetchImpl(embedUrl, { signal: context.signal });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError({
          provider: name,
          code: "PROVIDER_UNAVAILABLE",
          retryable: response.status >= 500,
          message: `Initem embed returned HTTP ${response.status}.`,
        });
      }
      const html = await readBoundedResponseText(name, response, 1024 * 1024, {
        signal: context.signal,
      });
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]?.trim();
      if (
        !title ||
        !html.includes("makePlayer({") ||
        !html.includes("master.m3u8") ||
        !html.includes('"names"')
      ) {
        throw invalidResponse(name);
      }

      const ids = { ...query.ids, [lookup.source === "kp" ? "kinopoisk" : "imdb"]: lookup.id };
      return {
        query,
        item: { type: query.type, title: query.title ?? title, year: query.year, ids },
        options: [
          {
            id: `${name}:${lookup.source}:${lookup.id}`,
            provider: name,
            player: { kind: "embed", label: "Initem", providerPlayerId: lookup.id },
            access: { url: embedUrl },
            availability: "available",
            sourceUrl: embedUrl,
          },
        ],
        sourceProviders: [{ provider: name, url: embedUrl, ids }],
        checkedAt: new Date().toISOString(),
      } satisfies MediaAvailability;
    },
  };
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: false,
    message: "Initem did not return a playable embed.",
  });
}
