import type { Cache } from "../cache/index.js";
import type { MergeStrategy } from "../merge/index.js";
import type { MediaProvider } from "../providers/index.js";

// Options accepted by the MediaEngine constructor.
// Опции, которые принимает constructor MediaEngine.
export interface MediaEngineOptions {
  providers?: MediaProvider[];
  cache?: Cache;
  mergeStrategy?: MergeStrategy;
  timeoutMs?: number;
  debug?: boolean;
}
