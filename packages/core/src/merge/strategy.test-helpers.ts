import type { MediaDetails, MediaItem } from "../media/index.js";
import type { ProviderDetailsResult, ProviderSearchResult } from "../providers/index.js";

export function providerResult(
  provider: string,
  item: MediaItem & { confidence?: number },
): ProviderSearchResult {
  const { confidence, ...mediaItem } = item;

  return {
    provider,
    item: mediaItem,
    confidence,
  };
}

export function providerDetailsResult(
  provider: string,
  details: MediaDetails,
): ProviderDetailsResult {
  return {
    provider,
    details,
  };
}
