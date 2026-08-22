import { ProviderError, type MediaAvailability, type ProviderContext } from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import { getHardenedProviderResponseUrl } from "../shared/safe-fetch.js";
import type { VeoVeoStreamingConfig } from "./config.js";

const LOOKUP_ENTRY_LIMIT = 32;
const TRANSLATION_ENTRY_LIMIT = 64;

export interface VeoVeoLookup {
  source: "kinopoisk" | "imdb";
  id: string;
}

export interface VeoVeoVariant {
  url: string;
  title?: string;
}

export interface VeoVeoCatalogItem {
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  variants: VeoVeoVariant[];
}

export interface VeoVeoLookupResult {
  contentId: string;
  sourceUrl: string;
}

export function resolveVeoVeoLookup(query: MediaAvailability["query"]): VeoVeoLookup | undefined {
  const kinopoisk = query.ids?.kinopoisk ?? query.kinopoisk;
  if (kinopoisk && /^[1-9]\d{0,11}$/u.test(kinopoisk)) {
    return { source: "kinopoisk", id: kinopoisk };
  }

  const imdb = query.ids?.imdb ?? query.imdb;
  if (imdb && /^tt\d{7,10}$/u.test(imdb)) {
    return { source: "imdb", id: imdb };
  }

  return undefined;
}

export async function lookupVeoVeoContentId(
  config: VeoVeoStreamingConfig,
  lookup: VeoVeoLookup,
  context: ProviderContext,
): Promise<VeoVeoLookupResult | null> {
  const url = createLookupUrl(config.lookupBaseUrl, lookup);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxRetries: 0,
    maxResponseBytes: config.maxLookupResponseBytes,
    init: { headers: createHeaders(config) },
  });
  const contentId = parseVeoVeoContentId(config.name, payload);

  return contentId ? { contentId, sourceUrl: url.href } : null;
}

export async function loadVeoVeoCatalog(
  config: VeoVeoStreamingConfig,
  contentId: string,
  context: ProviderContext,
): Promise<VeoVeoCatalogItem[]> {
  const url = createCatalogUrl(config.streamBaseUrl, contentId);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxRetries: 0,
    maxResponseBytes: config.maxCatalogResponseBytes,
    init: { headers: createHeaders(config) },
  });

  return parseVeoVeoCatalog(config.name, payload, config.catalogItemLimit, config.variantLimit);
}

export async function resolveVeoVeoManifestUrls(
  config: VeoVeoStreamingConfig,
  catalog: VeoVeoCatalogItem[],
  query: MediaAvailability["query"],
  context: ProviderContext,
): Promise<VeoVeoCatalogItem[]> {
  if (
    query.type === "series" &&
    (query.seasonNumber === undefined || query.episodeNumber === undefined)
  ) {
    return catalog;
  }

  return Promise.all(
    catalog.map(async (item) => {
      if (!isRequestedCatalogItem(item, query)) return item;

      const variants = await Promise.all(
        item.variants.map((variant) => resolveManifestVariant(config, variant, context)),
      );
      return { ...item, variants: variants.filter((variant) => variant !== undefined) };
    }),
  );
}

export function createLookupUrl(baseUrl: string, lookup: VeoVeoLookup): URL {
  const url = new URL("/api/players", `${baseUrl}/`);
  url.searchParams.set(lookup.source, lookup.id);
  url.searchParams.set("n", "0");
  return url;
}

export function createCatalogUrl(baseUrl: string, contentId: string): URL {
  const url = new URL("/balancer-api/proxy/playlists/catalog-api/episodes", `${baseUrl}/`);
  url.searchParams.set("content-id", contentId);
  return url;
}

export function parseVeoVeoContentId(provider: string, value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.data)) throw invalidResponse(provider, "lookup");

  const ids = new Set<string>();
  for (const entry of value.data.slice(0, LOOKUP_ENTRY_LIMIT)) {
    if (!isRecord(entry) || normalizeText(entry.type) !== "veoveo") continue;

    collectContentId(ids, entry.iframeUrl);
    if (!Array.isArray(entry.translations)) continue;
    for (const translation of entry.translations.slice(0, TRANSLATION_ENTRY_LIMIT)) {
      if (isRecord(translation)) collectContentId(ids, translation.iframeUrl);
    }
  }

  return ids.size === 1 ? ids.values().next().value : undefined;
}

export function parseVeoVeoCatalog(
  provider: string,
  value: unknown,
  itemLimit: number,
  variantLimit: number,
): VeoVeoCatalogItem[] {
  if (!Array.isArray(value)) throw invalidResponse(provider, "catalog");

  const items = value.slice(0, itemLimit).flatMap((entry) => {
    const item = parseCatalogItem(entry, variantLimit);
    return item ? [item] : [];
  });

  if (value.length > 0 && items.length === 0) throw invalidResponse(provider, "catalog");
  return items;
}

function parseCatalogItem(value: unknown, variantLimit: number): VeoVeoCatalogItem | undefined {
  if (!isRecord(value) || !isRecord(value.season) || !Array.isArray(value.episodeVariants)) {
    return undefined;
  }

  const seasonNumber = readInteger(value.season.order, 0);
  const episodeNumber = readInteger(value.order, 0);
  if (seasonNumber === undefined || episodeNumber === undefined) return undefined;

  const variants = value.episodeVariants.slice(0, variantLimit).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.filepath !== "string" || !entry.filepath.trim()) return [];
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    return [{ url: entry.filepath.trim(), ...(title ? { title } : {}) }];
  });

  const title = typeof value.title === "string" ? value.title.trim() : "";
  return {
    seasonNumber,
    episodeNumber,
    ...(title ? { title } : {}),
    variants,
  };
}

function collectContentId(target: Set<string>, value: unknown): void {
  if (typeof value !== "string" || !value.trim()) return;

  try {
    const url = new URL(value);
    const ids = url.searchParams.getAll("movie_id");
    if (url.protocol !== "https:" || ids.length !== 1 || !/^[1-9]\d{0,11}$/u.test(ids[0]!)) {
      return;
    }
    target.add(ids[0]!);
  } catch {
    return;
  }
}

function createHeaders(config: VeoVeoStreamingConfig): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
  };
}

async function resolveManifestVariant(
  config: VeoVeoStreamingConfig,
  variant: VeoVeoVariant,
  context: ProviderContext,
): Promise<VeoVeoVariant | undefined> {
  const sourceUrl = normalizeManifestUrl(variant.url);
  if (!sourceUrl) return undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await config.rateLimitGate.wait(context.signal);
      const response = await config.fetch(sourceUrl, {
        headers: {
          Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8",
          "User-Agent": config.userAgent,
        },
        signal: context.signal,
      });

      try {
        if (!response.ok || !isHlsContentType(response.headers.get("content-type"))) continue;
        const finalUrl = normalizeManifestUrl(
          getHardenedProviderResponseUrl(response) ?? sourceUrl.href,
        );
        if (finalUrl) return { ...variant, url: finalUrl.href };
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (context.signal?.aborted) throw context.signal.reason ?? error;
    }
  }

  return undefined;
}

function isRequestedCatalogItem(
  item: VeoVeoCatalogItem,
  query: MediaAvailability["query"],
): boolean {
  if (query.type === "movie") return item.seasonNumber === 0;
  return item.seasonNumber === query.seasonNumber && item.episodeNumber === query.episodeNumber;
}

function normalizeManifestUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /\.m3u8$/iu.test(url.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
}

function isHlsContentType(value: string | null): boolean {
  const contentType = value?.split(";", 1)[0]?.trim().toLocaleLowerCase();
  return (
    contentType === "application/vnd.apple.mpegurl" ||
    contentType === "application/x-mpegurl" ||
    contentType === "audio/mpegurl" ||
    contentType === "audio/x-mpegurl"
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/gu, "") : "";
}

function readInteger(value: unknown, minimum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum
    ? (value as number)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(provider: string, stage: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid VeoVeo ${stage} response.`,
    retryable: false,
  });
}
