import type { MediaAvailability } from "@media-engine/core";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import type { RutubeMovieCandidate } from "./client.js";
import type { RutubeStreamingConfig } from "./config.js";

export function mapRutubeAvailability(
  config: Pick<RutubeStreamingConfig, "name" | "baseUrl" | "now">,
  candidate: RutubeMovieCandidate,
  query: MediaAvailability["query"],
): MediaAvailability | null {
  const embedUrl = normalizeProviderOutputUrl(
    new URL(`/play/embed/${candidate.id}`, `${config.baseUrl}/`).href,
  );
  const sourceUrl = normalizeProviderOutputUrl(
    new URL(`/video/${candidate.id}/`, `${config.baseUrl}/`).href,
  );
  if (!embedUrl || !sourceUrl) return null;

  return {
    query,
    item: {
      type: "movie",
      title: query.title,
      year: query.year,
    },
    options: [
      {
        id: `${config.name}:${candidate.id}`,
        provider: config.name,
        player: {
          kind: "embed",
          label: "Rutube",
          providerPlayerId: candidate.id,
        },
        access: { url: embedUrl },
        availability: "available",
        sourceUrl,
      },
    ],
    sourceProviders: [{ provider: config.name, url: sourceUrl }],
    checkedAt: new Date(config.now()).toISOString(),
  };
}
