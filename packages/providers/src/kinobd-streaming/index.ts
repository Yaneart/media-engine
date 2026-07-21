import type { StreamingProvider } from "@media-engine/core";
import { getKinoBdAvailability } from "./availability.js";
import { createCapabilities, createConfig, type KinoBdStreamingProviderOptions } from "./config.js";

export type {
  KinoBdFilteredPlayerAuditEntry,
  KinoBdPlayerAudit,
  KinoBdPlayerAuditMetrics,
  KinoBdPlayerFilterReason,
  KinoBdStreamingProviderOptions,
} from "./config.js";

// Creates a no-token streaming provider that asks KinoBD-style endpoints for iframe players.
// Создает no-token streaming-провайдер, который запрашивает iframe-плееры через KinoBD-style endpoints.
export function kinobdStreamingProvider(
  options: KinoBdStreamingProviderOptions = {},
): StreamingProvider {
  const config = createConfig(options);

  return {
    name: config.name,
    version: options.version,
    kind: "streaming",
    capabilities: createCapabilities(),
    async getAvailability(query, context) {
      return getKinoBdAvailability(config, query, context);
    },
  };
}
