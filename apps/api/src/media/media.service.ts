import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  type DetailsQuery,
  type DetailsResponse,
  type ExternalIds,
  type MediaAvailability,
  type MediaEngine,
  type MediaEngineOperationOptions,
  type MediaType,
  type ProviderInfo,
  type SearchQuery,
  type SearchResponse,
  type StreamQuery,
  type StreamingProviderInfo,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';
import { rethrowMediaEngineHttpError } from '../media-engine/media-engine.errors';
import {
  isMediaType,
  NESTED_ONLY_EXTERNAL_ID_KEYS,
  TOP_LEVEL_EXTERNAL_ID_KEYS,
} from '../media-query/media-query.constants';

// EN: Raw query shape received from HTTP before API-level normalization.
// RU: Сырая форма query из HTTP до нормализации на уровне API.
export type MediaSearchHttpQuery = Record<
  string,
  string | string[] | undefined
>;

// EN: Raw details query shape received from HTTP before API-level normalization.
// RU: Сырая форма details query из HTTP до нормализации на уровне API.
export type MediaDetailsHttpQuery = Record<
  string,
  string | string[] | undefined
>;

// EN: Raw streaming availability query shape received from HTTP before normalization.
// RU: Сырая форма streaming availability query из HTTP до нормализации.
export type MediaAvailabilityHttpQuery = Record<
  string,
  string | string[] | undefined
>;

@Injectable()
// EN: Application service that adapts HTTP media requests to the core engine.
// RU: Сервис приложения, который адаптирует HTTP media запросы к core engine.
export class MediaService {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly mediaEngine: MediaEngine,
  ) {}

  // EN: Convert HTTP query parameters into a core SearchQuery and run search.
  // RU: Преобразует HTTP query параметры в core SearchQuery и запускает поиск.
  async search(
    query: MediaSearchHttpQuery,
    options?: MediaEngineOperationOptions,
  ): Promise<SearchResponse> {
    return runEngineRequest(() =>
      this.mediaEngine.search(toSearchQuery(query), options),
    );
  }

  // EN: Convert HTTP query parameters into a core DetailsQuery and load details.
  // RU: Преобразует HTTP query параметры в core DetailsQuery и загружает детали.
  async getDetails(
    query: MediaDetailsHttpQuery,
    options?: MediaEngineOperationOptions,
  ): Promise<DetailsResponse> {
    return runEngineRequest(() =>
      this.mediaEngine.getDetails(toDetailsQuery(query), options),
    );
  }

  // EN: Convert HTTP query parameters into a core StreamQuery and load player options.
  // RU: Преобразует HTTP query параметры в core StreamQuery и загружает player-варианты.
  async getAvailability(
    query: MediaAvailabilityHttpQuery,
    options?: MediaEngineOperationOptions,
  ): Promise<MediaAvailability> {
    return runEngineRequest(() =>
      this.mediaEngine.getAvailability(toStreamQuery(query), options),
    );
  }

  // EN: Return safe provider metadata from the configured core engine.
  // RU: Возвращает безопасные метаданные провайдеров из настроенного core engine.
  getProviders(): ProviderInfo[] {
    return this.mediaEngine.getProviders();
  }

  // EN: Return safe streaming provider metadata from the configured core engine.
  // RU: Возвращает безопасные метаданные streaming-провайдеров из настроенного core engine.
  getStreamingProviders(): StreamingProviderInfo[] {
    return this.mediaEngine.getStreamingProviders();
  }
}

// EN: Build the public core query from supported GET /media/search parameters.
// RU: Собирает публичный core query из поддерживаемых параметров GET /media/search.
export function toSearchQuery(query: MediaSearchHttpQuery): SearchQuery {
  const searchQuery: SearchQuery = {};
  const title = readString(query.title);
  const language = readString(query.language);
  const type = readMediaType(query.type);
  const year = readInteger(query.year, 'year');
  const limit = readInteger(query.limit, 'limit');

  if (title !== undefined) {
    searchQuery.title = title;
  }

  if (language !== undefined) {
    searchQuery.language = language;
  }

  if (type !== undefined) {
    searchQuery.type = type;
  }

  if (year !== undefined) {
    searchQuery.year = year;
  }

  if (limit !== undefined) {
    searchQuery.limit = limit;
  }

  copyExternalIds(query, searchQuery);

  return searchQuery;
}

// EN: Build the public core details query from supported GET /media/details parameters.
// RU: Собирает публичный core details query из поддерживаемых параметров GET /media/details.
export function toDetailsQuery(query: MediaDetailsHttpQuery): DetailsQuery {
  const detailsQuery: DetailsQuery = {};
  const id = readString(query.id);
  const language = readString(query.language);
  const type = readMediaType(query.type);

  // EN: Forward the deprecated value so core can return its explicit migration error.
  // RU: Передаем устаревшее значение, чтобы core вернул явную migration-ошибку.
  if (id !== undefined) {
    detailsQuery.id = id;
  }

  if (language !== undefined) {
    detailsQuery.language = language;
  }

  if (type !== undefined) {
    detailsQuery.type = type;
  }

  copyExternalIds(query, detailsQuery);

  return detailsQuery;
}

// EN: Build the public core streaming query from GET /media/availability parameters.
// RU: Собирает публичный core streaming query из параметров GET /media/availability.
export function toStreamQuery(query: MediaAvailabilityHttpQuery): StreamQuery {
  const title = readString(query.title);
  const language = readString(query.language);
  const type = readMediaType(query.type);
  const year = readInteger(query.year, 'year');
  const seasonNumber = readInteger(query.seasonNumber, 'seasonNumber');
  const episodeNumber = readInteger(query.episodeNumber, 'episodeNumber');
  const absoluteEpisodeNumber = readInteger(
    query.absoluteEpisodeNumber,
    'absoluteEpisodeNumber',
  );
  const providers = readStringList(query.providers);

  if (type === undefined) {
    throw new BadRequestException('type is required.');
  }

  const streamQuery: StreamQuery = { type };

  if (title !== undefined) {
    streamQuery.title = title;
  }

  if (language !== undefined) {
    streamQuery.language = language;
  }

  if (year !== undefined) {
    streamQuery.year = year;
  }

  if (seasonNumber !== undefined) {
    streamQuery.seasonNumber = seasonNumber;
  }

  if (episodeNumber !== undefined) {
    streamQuery.episodeNumber = episodeNumber;
  }

  if (absoluteEpisodeNumber !== undefined) {
    streamQuery.absoluteEpisodeNumber = absoluteEpisodeNumber;
  }

  if (providers.length > 0) {
    streamQuery.providers = providers;
  }

  copyExternalIds(query, streamQuery);

  return streamQuery;
}

// EN: Read the first string query value and treat blanks as absent.
// RU: Читает первое строковое query значение и считает пустые строки отсутствующими.
function readString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

// EN: Parse integer query parameters before they reach the core engine.
// RU: Парсит целочисленные query параметры до передачи в core engine.
function readInteger(
  value: string | string[] | undefined,
  field: string,
): number | undefined {
  const raw = readString(value);

  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    throw new BadRequestException(`${field} must be an integer.`);
  }

  return parsed;
}

// EN: Read repeated or comma-separated string query values.
// RU: Читает повторяющиеся или разделенные запятыми строковые query значения.
function readStringList(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];

  return values
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// EN: Apply the shared top-level shortcut precedence and nested-only IDs.
// RU: Применяет общий приоритет сокращений и nested-only ID.
function copyExternalIds(
  query: Record<string, string | string[] | undefined>,
  target: ExternalIdQueryTarget,
): void {
  for (const key of TOP_LEVEL_EXTERNAL_ID_KEYS) {
    const value = readString(query[key]) ?? readString(query[`ids.${key}`]);

    if (value !== undefined) {
      target[key] = value;
    }
  }

  const ids: ExternalIds = {};

  for (const key of NESTED_ONLY_EXTERNAL_ID_KEYS) {
    const value = readString(query[`ids.${key}`]);

    if (value !== undefined) {
      ids[key] = value;
    }
  }

  if (Object.keys(ids).length > 0) {
    target.ids = ids;
  }
}

// EN: Accept only the media type values supported by the public core model.
// RU: Принимает только значения media type, поддержанные публичной core моделью.
function readMediaType(
  value: string | string[] | undefined,
): MediaType | undefined {
  const raw = readString(value);

  if (raw === undefined) {
    return undefined;
  }

  if (isMediaType(raw)) {
    return raw;
  }

  throw new BadRequestException('type must be movie, series, or anime.');
}

// EN: Keep core-to-HTTP error mapping consistent across media endpoints.
// RU: Держит единый mapping ошибок core в HTTP для media endpoints.
async function runEngineRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowMediaEngineHttpError(error);
  }
}

type ExternalIdQueryTarget = {
  ids?: ExternalIds;
} & Partial<Record<(typeof TOP_LEVEL_EXTERNAL_ID_KEYS)[number], string>>;
