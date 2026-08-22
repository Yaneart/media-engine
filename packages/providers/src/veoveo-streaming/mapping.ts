import type {
  ExternalIds,
  MediaAvailability,
  StreamEpisodeAvailability,
  StreamOption,
} from "@media-engine/core";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import type { VeoVeoCatalogItem, VeoVeoLookup, VeoVeoVariant } from "./client.js";

export function mapVeoVeoAvailability(
  provider: string,
  contentId: string,
  catalog: VeoVeoCatalogItem[],
  query: MediaAvailability["query"],
  lookup: VeoVeoLookup,
  sourceUrl: string,
  expiresAt: string,
  checkedAt: string,
): MediaAvailability | null {
  if (query.type === "movie") {
    const options = selectItems(catalog, 0).flatMap((item) =>
      mapItemOptions(provider, contentId, item, sourceUrl, expiresAt),
    );
    if (options.length === 0) return null;

    return createAvailability(query, lookup, sourceUrl, provider, checkedAt, options);
  }

  const selectedItems = selectSeriesItems(catalog, query);
  const episodes = selectedItems.flatMap((item) => {
    const options = mapItemOptions(provider, contentId, item, sourceUrl, expiresAt);
    return options.length > 0
      ? [
          {
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            title: item.title,
            options,
          } satisfies StreamEpisodeAvailability,
        ]
      : [];
  });
  const options = episodes.flatMap((episode) => episode.options);
  if (options.length === 0) return null;

  return {
    ...createAvailability(query, lookup, sourceUrl, provider, checkedAt, options),
    episodes,
  };
}

function createAvailability(
  query: MediaAvailability["query"],
  lookup: VeoVeoLookup,
  sourceUrl: string,
  provider: string,
  checkedAt: string,
  options: StreamOption[],
): MediaAvailability {
  const ids = createIds(query.ids, lookup);
  return {
    query,
    item: {
      type: query.type,
      title: query.title,
      year: query.year,
      ids,
    },
    options,
    sourceProviders: [{ provider, url: sourceUrl, ids }],
    checkedAt,
  };
}

function selectItems(catalog: VeoVeoCatalogItem[], seasonNumber: number): VeoVeoCatalogItem[] {
  return mergeItems(catalog.filter((item) => item.seasonNumber === seasonNumber));
}

function selectSeriesItems(
  catalog: VeoVeoCatalogItem[],
  query: MediaAvailability["query"],
): VeoVeoCatalogItem[] {
  return mergeItems(
    catalog.filter(
      (item) =>
        item.seasonNumber > 0 &&
        (query.seasonNumber === undefined || item.seasonNumber === query.seasonNumber) &&
        (query.episodeNumber === undefined || item.episodeNumber === query.episodeNumber),
    ),
  );
}

function mergeItems(items: VeoVeoCatalogItem[]): VeoVeoCatalogItem[] {
  const merged = new Map<string, VeoVeoCatalogItem>();

  for (const item of items) {
    const key = `${item.seasonNumber}:${item.episodeNumber}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, variants: [...item.variants] });
      continue;
    }
    existing.variants.push(...item.variants);
    if (!existing.title && item.title) existing.title = item.title;
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber,
  );
}

function mapItemOptions(
  provider: string,
  contentId: string,
  item: VeoVeoCatalogItem,
  sourceUrl: string,
  expiresAt: string,
): StreamOption[] {
  const seenUrls = new Set<string>();

  return item.variants.flatMap((variant, index) => {
    const url = normalizeHlsUrl(variant.url);
    if (!url || seenUrls.has(url)) return [];
    seenUrls.add(url);

    return [createOption(provider, contentId, item, variant, index, url, sourceUrl, expiresAt)];
  });
}

function createOption(
  provider: string,
  contentId: string,
  item: VeoVeoCatalogItem,
  variant: VeoVeoVariant,
  index: number,
  url: string,
  sourceUrl: string,
  expiresAt: string,
): StreamOption {
  const height = parseHeight(variant.title);
  const translationTitle = height ? "VeoVeo" : variant.title?.trim() || "VeoVeo";
  const episode =
    item.seasonNumber > 0
      ? { seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber }
      : undefined;

  return {
    id: `${provider}:${contentId}:${item.seasonNumber}:${item.episodeNumber}:${index}`,
    provider,
    player: {
      kind: "hls",
      label: "VeoVeo",
      providerPlayerId: `${contentId}:${item.seasonNumber}:${item.episodeNumber}:${index}`,
    },
    translation: {
      title: translationTitle,
      type: "unknown",
      team: translationTitle,
    },
    quality: { label: height ? `${height}p` : "Auto", ...(height ? { height } : {}) },
    ...(episode ? { episode } : {}),
    access: { url },
    availability: "available",
    expiresAt,
    sourceUrl,
  };
}

function normalizeHlsUrl(value: string): string | undefined {
  const normalized = normalizeProviderOutputUrl(value);
  if (!normalized) return undefined;

  const url = new URL(normalized);
  return url.protocol === "https:" && /\.m3u8$/iu.test(url.pathname) ? url.href : undefined;
}

function parseHeight(value: string | undefined): number | undefined {
  const title = value?.trim();
  const match = title?.match(/(?:^|\D)(\d{3,4})p?(?:\D|$)/iu);
  return match ? Number(match[1]) : undefined;
}

function createIds(existing: ExternalIds | undefined, lookup: VeoVeoLookup): ExternalIds {
  return { ...existing, [lookup.source]: lookup.id };
}
