import { ProviderError, type ProviderContext } from "@media-engine/core";
import { fetchJson } from "../shared/index.js";
import type { DdbbStreamingConfig } from "./config.js";
import type { DdbbLookup } from "./mapping.js";

const PLAYER_ENTRY_LIMIT = 32;
const TRANSLATION_ENTRY_LIMIT = 64;

export interface DdbbTranslation {
  id?: string;
  name?: string;
  quality?: string;
  iframeUrl?: string;
}

export interface DdbbPlayer {
  type: string;
  iframeUrl?: string;
  translations: DdbbTranslation[];
}

export interface DdbbPlayerResponse {
  players: DdbbPlayer[];
  sourceUrl: string;
}

export async function loadDdbbPlayers(
  config: DdbbStreamingConfig,
  lookup: DdbbLookup,
  context: ProviderContext,
): Promise<DdbbPlayerResponse> {
  const url = createDdbbLookupUrl(config.baseUrl, lookup);
  const payload = await fetchJson<unknown>({
    provider: config.name,
    url,
    context,
    fetch: config.fetch,
    rateLimitGate: config.rateLimitGate,
    maxResponseBytes: config.maxResponseBytes,
    init: {
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent,
      },
    },
  });

  return {
    players: parseDdbbResponse(config.name, payload),
    sourceUrl: url.href,
  };
}

export function createDdbbLookupUrl(baseUrl: string, lookup: DdbbLookup): URL {
  const url = new URL("/api/players", `${baseUrl}/`);
  url.searchParams.set(lookup.source, lookup.id);
  url.searchParams.set("n", "0");
  return url;
}

export function parseDdbbResponse(provider: string, value: unknown): DdbbPlayer[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw invalidResponse(provider);
  }

  const players = value.data.slice(0, PLAYER_ENTRY_LIMIT).flatMap((entry) => {
    const player = parsePlayer(entry);
    return player ? [player] : [];
  });

  if (value.data.length > 0 && players.length === 0) {
    throw invalidResponse(provider);
  }

  return players;
}

function parsePlayer(value: unknown): DdbbPlayer | undefined {
  if (!isRecord(value)) return undefined;

  const type = readOptionalString(value.type);
  const iframeUrl = readNullableString(value.iframeUrl);
  if (!type || iframeUrl === false || !Array.isArray(value.translations)) return undefined;

  return {
    type,
    ...(iframeUrl ? { iframeUrl } : {}),
    translations: value.translations.slice(0, TRANSLATION_ENTRY_LIMIT).flatMap((translation) => {
      const parsed = parseTranslation(translation);
      return parsed ? [parsed] : [];
    }),
  };
}

function parseTranslation(value: unknown): DdbbTranslation | undefined {
  if (!isRecord(value)) return undefined;

  const iframeUrl = readNullableString(value.iframeUrl);
  const name = readNullableString(value.name);
  const quality = readNullableString(value.quality);
  if (iframeUrl === false || name === false || quality === false) return undefined;

  const id =
    typeof value.id === "string" || typeof value.id === "number"
      ? String(value.id).trim() || undefined
      : undefined;

  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(quality ? { quality } : {}),
    ...(iframeUrl ? { iframeUrl } : {}),
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, 200) || undefined : undefined;
}

function readNullableString(value: unknown): string | undefined | false {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value.trim().slice(0, 8_192) || undefined : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(provider: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an invalid DDBB player response.`,
    retryable: false,
  });
}
