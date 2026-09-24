import { ProviderError, type MediaAvailability, type StreamingProvider } from "@media-engine/core";
import { fetchJson, normalizeProviderOutputUrl, type ProviderFetch } from "../shared/index.js";
import { createHardenedProviderFetch } from "../shared/safe-fetch.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";

const KINOPOISK_ID = /^[1-9]\d{0,11}$/u;
const IMDB_ID = /^tt\d{7,9}$/u;
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";

export interface AderomStreamingProviderOptions {
  apiBaseUrl?: string;
  embedBaseUrl?: string;
  fetch?: ProviderFetch;
}

// Aderom indexes dubbed series and anime. Its published iframe keeps voice and episode selection inside the player.
export function aderomStreamingProvider(
  options: AderomStreamingProviderOptions = {},
): StreamingProvider {
  const name = "aderom-streaming";
  const apiBaseUrl = readBaseUrl(options.apiBaseUrl ?? "https://aderom.net");
  const embedBaseUrl = readBaseUrl(options.embedBaseUrl ?? "https://gencit.info");
  const fetchImpl =
    options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 3 });

  return {
    name,
    kind: "streaming",
    capabilities: {
      mediaTypes: ["series", "anime"],
      lookup: { byTitle: false, byExternalIds: ["kinopoisk", "imdb"], byEpisode: false },
      features: ["embed", "translations"],
    },
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(name)) return null;
      if (query.type !== "series" && query.type !== "anime") return null;
      if (
        query.seasonNumber !== undefined ||
        query.episodeNumber !== undefined ||
        query.absoluteEpisodeNumber !== undefined
      )
        return null;
      const kinopoiskId =
        query.ids?.kinopoisk ??
        query.kinopoisk ??
        (await resolveKinopoiskId(query.ids?.imdb ?? query.imdb, context, fetchImpl));
      if (!kinopoiskId || !KINOPOISK_ID.test(kinopoiskId)) return null;

      const sourceUrl = new URL(`/api/${kinopoiskId}`, apiBaseUrl).href;
      const payload = await fetchJson<unknown>({
        provider: name,
        url: sourceUrl,
        context,
        fetch: fetchImpl,
        maxRetries: 0,
        maxResponseBytes: 256 * 1024,
      });
      if (isRecord(payload) && payload.error === "not found") return null;
      if (
        !isRecord(payload) ||
        String(payload.kinopoisk_id) !== kinopoiskId ||
        typeof payload.title !== "string" ||
        !payload.title.trim() ||
        typeof payload.category !== "string" ||
        !Array.isArray(payload.translation)
      ) {
        throw invalidResponse(name);
      }
      const category = payload.category.toLowerCase();
      if (query.type === "anime" ? !category.includes("аниме") : !category.includes("сериал"))
        return null;
      if (
        !payload.translation.some(
          (entry) => isRecord(entry) && typeof entry.name === "string" && entry.name.trim(),
        )
      )
        return null;

      const embedUrl = normalizeProviderOutputUrl(
        new URL(`/tvb/${kinopoiskId}`, embedBaseUrl).href,
      );
      if (!embedUrl) throw invalidResponse(name);
      const response = await fetchImpl(embedUrl, { signal: context.signal });
      await response.body?.cancel();
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new ProviderError({
          provider: name,
          code: "PROVIDER_UNAVAILABLE",
          retryable: response.status >= 500,
          message: `Aderom embed returned HTTP ${response.status}.`,
        });
      }

      const ids = { ...query.ids, kinopoisk: kinopoiskId };
      return {
        query,
        item: { type: query.type, title: payload.title.trim(), year: readYear(payload.year), ids },
        options: [
          {
            id: `${name}:${kinopoiskId}`,
            provider: name,
            player: { kind: "embed", label: "Aderom", providerPlayerId: kinopoiskId },
            access: { url: embedUrl },
            availability: "available",
            sourceUrl,
          },
        ],
        sourceProviders: [{ provider: name, url: sourceUrl, ids }],
        checkedAt: new Date().toISOString(),
      } satisfies MediaAvailability;
    },
  };
}

async function resolveKinopoiskId(
  imdbId: string | undefined,
  context: Parameters<StreamingProvider["getAvailability"]>[1],
  fetchImpl: ProviderFetch,
): Promise<string | undefined> {
  if (!imdbId || !IMDB_ID.test(imdbId)) return undefined;
  const searchUrl = new URL(WIKIDATA_API_URL);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", `haswbstatement:P345=${imdbId}`);
  searchUrl.searchParams.set("srnamespace", "0");
  searchUrl.searchParams.set("srlimit", "2");
  searchUrl.searchParams.set("srprop", "");
  searchUrl.searchParams.set("format", "json");
  const search = await requestWikidata(searchUrl, context, fetchImpl);
  if (!isRecord(search) || !isRecord(search.query) || !Array.isArray(search.query.search))
    throw invalidResponse("aderom-streaming");
  if (search.query.search.length !== 1) return undefined;
  const entity = search.query.search[0];
  if (!isRecord(entity) || typeof entity.title !== "string" || !/^Q[1-9]\d*$/u.test(entity.title))
    throw invalidResponse("aderom-streaming");

  const claimsUrl = new URL(WIKIDATA_API_URL);
  claimsUrl.searchParams.set("action", "wbgetclaims");
  claimsUrl.searchParams.set("entity", entity.title);
  claimsUrl.searchParams.set("property", "P2603");
  claimsUrl.searchParams.set("format", "json");
  const payload = await requestWikidata(claimsUrl, context, fetchImpl);
  if (!isRecord(payload) || !isRecord(payload.claims)) throw invalidResponse("aderom-streaming");
  if (payload.claims.P2603 === undefined) return undefined;
  if (!Array.isArray(payload.claims.P2603)) throw invalidResponse("aderom-streaming");
  const ids = new Set(
    payload.claims.P2603.map((claim: unknown) => {
      if (!isRecord(claim) || !isRecord(claim.mainsnak) || !isRecord(claim.mainsnak.datavalue))
        return undefined;
      return claim.mainsnak.datavalue.value;
    }),
  );
  const id = [...ids][0];
  return ids.size === 1 && typeof id === "string" && KINOPOISK_ID.test(id) ? id : undefined;
}

function requestWikidata(
  url: URL,
  context: Parameters<StreamingProvider["getAvailability"]>[1],
  fetchImpl: ProviderFetch,
): Promise<unknown> {
  return fetchJson({
    provider: "aderom-streaming",
    url: url.href,
    init: {
      headers: { accept: "application/json", "user-agent": MEDIA_ENGINE_DEFAULT_USER_AGENT },
    },
    context,
    fetch: fetchImpl,
    maxRetries: 0,
    maxResponseBytes: 64 * 1024,
  });
}

function readBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new TypeError("Aderom base URLs must be credential-free HTTPS URLs.");
  return url.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readYear(value: unknown): number | undefined {
  const year = typeof value === "number" ? value : Number(value);
  return Number.isInteger(year) && year >= 1888 && year <= 2200 ? year : undefined;
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: false,
    message: "Aderom returned an invalid or mismatched media record.",
  });
}
