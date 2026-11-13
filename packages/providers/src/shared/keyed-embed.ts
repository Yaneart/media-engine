import {
  ProviderError,
  type ExternalIds,
  type ProviderContext,
  type StreamingProvider,
  type StreamQuery,
} from "@media-engine/core";
import { fetchJson, getProviderHttpStatus, type ProviderFetch } from "./http.js";
import { normalizeProviderOutputUrl } from "./output-url.js";
import { ProviderRateLimitGate } from "./rate-limit.js";
import { createHardenedProviderFetch } from "./safe-fetch.js";
import { resolveBoundedIntegerOption } from "./options.js";
import { MEDIA_ENGINE_DEFAULT_USER_AGENT } from "../package-version.js";
import { mapEmbedCatalog, type EmbedRecord } from "./embed-catalog.js";
import { rethrowIfProviderAborted } from "./abort.js";

export interface KeyedEmbedProviderOptions {
  name?: string;
  version?: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: ProviderFetch;
  maxResponseBytes?: number;
  /** Public player credential, separate from the server API key. */
  playerToken?: string;
  /** Explicit opt-in for upstreams that use one credential for API and public embeds. */
  allowApiKeyInEmbedUrl?: boolean;
}

export type EmbedIdSource = "kinopoisk" | "imdb" | "tmdb";
export interface EmbedLookup {
  source: EmbedIdSource;
  id: string;
}
export interface EmbedClient {
  name: string;
  baseUrl: string;
  request(path: string, params: Record<string, string>, bearer?: boolean): Promise<unknown | null>;
  invalid(): never;
}

export function createKeyedEmbedProvider(
  options: KeyedEmbedProviderOptions,
  definition: {
    name: string;
    label: string;
    baseUrl: string;
    ids: EmbedIdSource[];
    byEpisode: boolean;
    load(client: EmbedClient, lookup: EmbedLookup, query: StreamQuery): Promise<EmbedRecord[]>;
  },
): StreamingProvider {
  const name = options.name?.trim() || definition.name;
  const baseUrl = normalizeEmbedBaseUrl(options.baseUrl ?? definition.baseUrl);
  const apiKey = options.apiKey?.trim();
  const fetchImpl =
    options.fetch ?? createHardenedProviderFetch({ provider: name, maxRedirects: 0 });
  const gate = new ProviderRateLimitGate();
  const maxResponseBytes = resolveBoundedIntegerOption(
    options.maxResponseBytes,
    2 * 1024 * 1024,
    `${name} maxResponseBytes`,
    1024,
    4 * 1024 * 1024,
  );
  return {
    name,
    version: options.version,
    kind: "streaming",
    capabilities: {
      mediaTypes: ["movie", "series", "anime"],
      lookup: { byTitle: false, byExternalIds: definition.ids, byEpisode: definition.byEpisode },
      features: ["embed", "translations", "qualities"],
    },
    async getAvailability(query, context) {
      if (query.providers && !query.providers.includes(name)) return null;
      const exact = hasEmbedEpisode(query);
      if (exact && (!definition.byEpisode || !validEpisodeQuery(query))) return null;
      const lookup = resolveEmbedLookup(query, definition.ids);
      if (!lookup) return null;
      if (!apiKey) throw embedError(name, "PROVIDER_UNAUTHORIZED", "requires apiKey");
      const signal = requestSignal(context);
      rethrowIfProviderAborted(context, new Error("Embed lookup cancelled."));
      if (signal.aborted) throw embedError(name, "PROVIDER_TIMEOUT", "request timed out", true);
      const client: EmbedClient = {
        name,
        baseUrl,
        invalid() {
          throw embedError(name, "PROVIDER_INVALID_RESPONSE", "returned an invalid response");
        },
        async request(path, params, bearer = false) {
          const url = new URL(path, `${baseUrl}/`);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
          if (!bearer) url.searchParams.set("token", apiKey);
          try {
            return await fetchJson<unknown>({
              provider: name,
              url,
              fetch: fetchImpl,
              context: { ...context, signal, timeoutMs: undefined },
              maxRetries: 0,
              maxResponseBytes,
              rateLimitGate: gate,
              init: {
                headers: {
                  Accept: "application/json",
                  "User-Agent": MEDIA_ENGINE_DEFAULT_USER_AGENT,
                  ...(bearer ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
              },
            });
          } catch (error) {
            rethrowIfProviderAborted(context, error);
            if (getProviderHttpStatus(error) === 404) return null;
            // Never carry upstream URLs, bodies or causes containing credentials into public diagnostics.
            const code = signal.aborted
              ? "PROVIDER_TIMEOUT"
              : error instanceof ProviderError
                ? error.code
                : "PROVIDER_UNAVAILABLE";
            throw embedError(
              name,
              code,
              `request failed (${code})`,
              error instanceof ProviderError ? error.retryable : true,
            );
          }
        },
      };
      const records = await definition.load(client, lookup, query);
      rethrowIfProviderAborted(context, new Error("Embed lookup cancelled."));
      const result = mapEmbedCatalog(name, definition.label, records, query, lookup, (raw) =>
        publicEmbedUrl(raw, options, apiKey, name),
      );
      if (!options.allowApiKeyInEmbedUrl && JSON.stringify(result).includes(apiKey)) {
        throw embedError(
          name,
          "PROVIDER_INVALID_RESPONSE",
          "returned a credential in public metadata",
        );
      }
      return result;
    },
  };
}

export function normalizeEmbedBaseUrl(value: string): string {
  const normalized = normalizeProviderOutputUrl(value);
  if (!normalized)
    throw new TypeError("Embed API baseUrl must be a public credential-free HTTPS URL.");
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.search || url.hash)
    throw new TypeError("Embed API baseUrl must use HTTPS without query or fragment.");
  return url.href.replace(/\/$/u, "");
}

function publicEmbedUrl(
  raw: string,
  options: KeyedEmbedProviderOptions,
  apiKey: string,
  name: string,
): string | undefined {
  const normalized = normalizeProviderOutputUrl(raw.startsWith("//") ? `https:${raw}` : raw);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.protocol !== "https:") return undefined;
  if (options.playerToken && url.searchParams.has("token"))
    url.searchParams.set("token", options.playerToken);
  let decoded = url.href;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return undefined;
  }
  if (!options.allowApiKeyInEmbedUrl && (url.href.includes(apiKey) || decoded.includes(apiKey))) {
    throw embedError(
      name,
      "PROVIDER_UNAUTHORIZED",
      "requires a separate playerToken; allowApiKeyInEmbedUrl explicitly permits a public shared credential",
    );
  }
  return url.href;
}

export function resolveEmbedLookup(
  query: StreamQuery,
  sources: EmbedIdSource[],
): EmbedLookup | undefined {
  for (const source of sources) {
    const id = query.ids?.[source] ?? query[source];
    if (id && (source === "imdb" ? /^tt\d{7,10}$/u : /^[1-9]\d{0,11}$/u).test(id))
      return { source, id };
  }
  return undefined;
}

export function hasEmbedEpisode(query: StreamQuery): boolean {
  return [query.seasonNumber, query.episodeNumber, query.absoluteEpisodeNumber].some(
    (v) => v !== undefined,
  );
}
function validEpisodeQuery(query: StreamQuery): boolean {
  return (
    Number.isSafeInteger(query.seasonNumber) &&
    query.seasonNumber! >= 0 &&
    Number.isSafeInteger(query.episodeNumber) &&
    query.episodeNumber! > 0 &&
    (query.absoluteEpisodeNumber === undefined ||
      (Number.isSafeInteger(query.absoluteEpisodeNumber) && query.absoluteEpisodeNumber > 0))
  );
}
function requestSignal(context: ProviderContext): AbortSignal {
  const milliseconds = Math.max(0, Math.floor(context.timeoutMs ?? 5000));
  const timeout = milliseconds === 0 ? AbortSignal.abort() : AbortSignal.timeout(milliseconds);
  return context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
}
export function embedError(
  provider: string,
  code: ProviderError["code"],
  detail: string,
  retryable = false,
): ProviderError {
  return new ProviderError({
    provider,
    code,
    message: `Provider "${provider}" ${detail}.`,
    retryable,
  });
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 8192) : undefined;
}
export function externalIds(
  value: Record<string, unknown>,
  fields: Partial<Record<EmbedIdSource, string>>,
): ExternalIds {
  const ids: ExternalIds = {};
  for (const [source, field] of Object.entries(fields)) {
    const raw = value[field];
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    let id = String(raw);
    if (source === "imdb" && /^\d{7,10}$/u.test(id)) id = `tt${id}`;
    if ((source === "imdb" ? /^tt\d{7,10}$/u : /^[1-9]\d{0,11}$/u).test(id))
      ids[source as EmbedIdSource] = id;
  }
  return ids;
}
