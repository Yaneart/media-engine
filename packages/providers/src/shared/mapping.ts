import type { Genre, Image, MediaType } from "@media-engine/core";
import { normalizeProviderOutputUrl } from "./output-url.js";

// Maps simple genre labels into normalized provider-attributed values.
// Преобразует простые названия жанров в нормализованные значения с источником.
export function mapGenreNames(genres: string[] | undefined, source: string): Genre[] | undefined {
  return genres?.map((name) => ({ name, source }));
}

// Creates one normalized provider-attributed image from a direct URL.
// Создает одно нормализованное изображение с источником из прямого URL.
export function createProviderImage(
  url: string | null | undefined,
  type: Image["type"],
  source: string,
): Image | undefined {
  const normalizedUrl = normalizeProviderOutputUrl(url);
  return normalizedUrl ? { url: normalizedUrl, type, source } : undefined;
}

// Normalizes text for conservative provider-local title comparisons.
// Нормализует текст для консервативного сравнения названий внутри провайдеров.
export function normalizeProviderSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Maps KinoBD API type labels shared by metadata and streaming adapters.
// Преобразует общие для metadata и streaming метки типов KinoBD API.
export function mapKinoBdMediaType(type: string | null | undefined): MediaType | undefined {
  if (type === "film") {
    return "movie";
  }

  if (type === "serial" || type === "series") {
    return "series";
  }

  return undefined;
}
