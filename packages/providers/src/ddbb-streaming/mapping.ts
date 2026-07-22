import type {
  ExternalIds,
  MediaAvailability,
  QualityInfo,
  StreamOption,
  TranslationInfo,
} from "@media-engine/core";
import { normalizeProviderOutputUrl } from "../shared/index.js";
import type { DdbbPlayer, DdbbTranslation } from "./client.js";

export interface DdbbLookup {
  source: "kinopoisk" | "imdb";
  id: string;
}

export interface DdbbMappedPlayers {
  options: StreamOption[];
  ids: ExternalIds;
}

export function resolveDdbbLookup(query: MediaAvailability["query"]): DdbbLookup | undefined {
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

export function mapDdbbPlayers(
  providerName: string,
  players: DdbbPlayer[],
  query: MediaAvailability["query"],
  lookup: DdbbLookup,
  sourceUrl: string,
  playerLimit: number,
): DdbbMappedPlayers {
  const seenUrls = new Set<string>();
  const primaryOptions: StreamOption[] = [];
  const translationOptions: StreamOption[] = [];

  for (const player of players) {
    const mainUrl = normalizeProviderOutputUrl(player.iframeUrl);
    if (mainUrl && !seenUrls.has(mainUrl)) {
      seenUrls.add(mainUrl);
      primaryOptions.push(
        createOption({
          providerName,
          player,
          lookup,
          sourceUrl,
          accessUrl: mainUrl,
          variant: "main",
        }),
      );
    }

    for (const [index, translation] of player.translations.entries()) {
      const translationUrl = normalizeProviderOutputUrl(translation.iframeUrl);
      if (!translationUrl || seenUrls.has(translationUrl)) continue;

      seenUrls.add(translationUrl);
      translationOptions.push(
        createOption({
          providerName,
          player,
          lookup,
          sourceUrl,
          accessUrl: translationUrl,
          translation,
          variant: `${translation.id ?? "translation"}-${index + 1}`,
        }),
      );
    }
  }

  return {
    options: [...primaryOptions, ...translationOptions].slice(0, playerLimit),
    ids: {
      ...query.ids,
      [lookup.source]: lookup.id,
    },
  };
}

interface CreateOptionInput {
  providerName: string;
  player: DdbbPlayer;
  lookup: DdbbLookup;
  sourceUrl: string;
  accessUrl: string;
  translation?: DdbbTranslation;
  variant: string;
}

function createOption(input: CreateOptionInput): StreamOption {
  const playerLabel = input.player.type.trim();
  const translation = input.translation ? mapTranslation(input.translation) : undefined;
  const quality = input.translation ? mapQuality(input.translation.quality) : undefined;
  const sourceUrl = normalizeProviderOutputUrl(input.sourceUrl);

  return {
    id: [
      input.providerName,
      input.lookup.source,
      input.lookup.id,
      slug(playerLabel),
      slug(input.variant),
    ].join(":"),
    provider: input.providerName,
    player: {
      kind: "embed",
      label: playerLabel,
      providerPlayerId: `${playerLabel}:${input.variant}`,
    },
    ...(translation ? { translation } : {}),
    ...(quality ? { quality } : {}),
    access: { url: input.accessUrl },
    availability: "available",
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function mapTranslation(value: DdbbTranslation): TranslationInfo | undefined {
  const title = value.name?.trim();
  if (!title) return undefined;

  const normalized = normalizeText(title);
  const type = inferTranslationType(normalized);
  const language = inferTranslationLanguage(title, normalized);

  return {
    ...(value.id ? { id: value.id } : {}),
    title,
    type,
    ...(language ? { language } : {}),
  };
}

function inferTranslationType(normalized: string): TranslationInfo["type"] {
  if (normalized.includes("субтит") || /\bsubs?\b/u.test(normalized)) return "subtitles";
  if (normalized.includes("оригинал") || /\boriginal\b/u.test(normalized)) return "original";
  if (normalized.includes("дубл") || /\bdub(?:bed)?\b/u.test(normalized)) return "dub";
  if (
    normalized.includes("голос") ||
    normalized.includes("закадр") ||
    normalized.includes("авторск")
  ) {
    return "voiceover";
  }
  return "unknown";
}

function inferTranslationLanguage(title: string, normalized: string): string | undefined {
  if (
    /[іїєґ]/iu.test(title) ||
    normalized.includes("украин") ||
    normalized.includes("україн") ||
    /\b(?:ukr|ua)\b/u.test(normalized)
  ) {
    return "uk";
  }

  if (normalized.includes("англий") || /\b(?:eng|english)\b/u.test(normalized)) return "en";
  if (normalized.includes("русск") || /\b(?:rus|russian)\b/u.test(normalized)) return "ru";
  if (/[а-яё]/iu.test(title) && !normalized.includes("оригинал")) return "ru";
  return undefined;
}

function mapQuality(value: string | undefined): QualityInfo | undefined {
  const label = value?.trim();
  if (!label) return undefined;

  const heightMatch = /(?:^|\D)(\d{3,4})p(?:\D|$)/iu.exec(label);
  const height = heightMatch?.[1] ? Number(heightMatch[1]) : undefined;

  return {
    label,
    ...(height && height >= 144 && height <= 4320 ? { height } : {}),
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function slug(value: string): string {
  return normalizeText(value).replace(/\s+/gu, "-") || "unknown";
}
