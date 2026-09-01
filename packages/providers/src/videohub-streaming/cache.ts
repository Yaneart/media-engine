import { MemoryCache } from "@media-engine/core";
import type { VideoHubPlaylist, VideoHubSourceResolution } from "./client.js";

const PLAYLIST_PREFIX = "playlist";
const VIDEO_PREFIX = "video";

// Bounded process-local cache; signed links are never served stale or beyond their original expiry.
// Ограниченный process-local кэш; подписанные ссылки не выдаются stale или после исходного expiry.
export class VideoHubStreamingCache {
  readonly #cache: MemoryCache;
  readonly #playlistTtlMs: number;
  readonly #now: () => number;

  constructor(options: { maxEntries: number; playlistTtlMs: number; now: () => number }) {
    this.#cache = new MemoryCache({ maxEntries: options.maxEntries, now: options.now });
    this.#playlistTtlMs = options.playlistTtlMs;
    this.#now = options.now;
  }

  getPlaylist(key: string): { playlist: VideoHubPlaylist; sourceUrl: string } | undefined {
    return this.#cache.get(`${PLAYLIST_PREFIX}:${key}`);
  }

  setPlaylist(key: string, value: { playlist: VideoHubPlaylist; sourceUrl: string }): void {
    if (this.#playlistTtlMs <= 0) return;
    this.#cache.set(`${PLAYLIST_PREFIX}:${key}`, value, {
      ttlMs: this.#playlistTtlMs,
      staleTtlMs: 0,
    });
  }

  getVideo(key: string): VideoHubSourceResolution | undefined {
    return this.#cache.get(`${VIDEO_PREFIX}:${key}`);
  }

  setVideo(key: string, value: VideoHubSourceResolution): void {
    const ttlMs = Date.parse(value.expiresAt) - this.#now() - 1_000;
    if (ttlMs <= 0) return;
    this.#cache.set(`${VIDEO_PREFIX}:${key}`, value, { ttlMs, staleTtlMs: 0 });
  }
}
