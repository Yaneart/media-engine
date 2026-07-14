import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type DetailsQuery,
  type DetailsResponse,
  type MediaAvailability,
  type MediaEngine,
  type MediaType,
  type ProviderInfo,
  type SearchQuery,
  type SearchResponse,
  type StreamQuery,
  type StreamingProviderInfo,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';

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

const MEDIA_TYPES: readonly MediaType[] = ['movie', 'series', 'anime'];
// EN: External ID shortcuts accepted as top-level HTTP query parameters.
// RU: Сокращения внешних ID, которые принимаются верхнеуровневыми HTTP query параметрами.
const EXTERNAL_ID_KEYS = [
  'imdb',
  'tmdb',
  'kinopoisk',
  'shikimori',
  'myAnimeList',
  'aniList',
] as const satisfies readonly (keyof SearchQuery)[];
const NESTED_ONLY_EXTERNAL_ID_KEYS = ['worldArt'] as const;

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
  async search(query: MediaSearchHttpQuery): Promise<SearchResponse> {
    return runEngineRequest(() =>
      this.mediaEngine.search(toSearchQuery(query)),
    );
  }

  // EN: Convert HTTP query parameters into a core DetailsQuery and load details.
  // RU: Преобразует HTTP query параметры в core DetailsQuery и загружает детали.
  async getDetails(query: MediaDetailsHttpQuery): Promise<DetailsResponse> {
    return runEngineRequest(() =>
      this.mediaEngine.getDetails(toDetailsQuery(query)),
    );
  }

  // EN: Convert HTTP query parameters into a core StreamQuery and load player options.
  // RU: Преобразует HTTP query параметры в core StreamQuery и загружает player-варианты.
  async getAvailability(
    query: MediaAvailabilityHttpQuery,
  ): Promise<MediaAvailability> {
    return runEngineRequest(() =>
      this.mediaEngine.getAvailability(toStreamQuery(query)),
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

  for (const key of EXTERNAL_ID_KEYS) {
    const value = readString(query[key] ?? query[`ids.${key}`]);

    if (value !== undefined) {
      searchQuery[key] = value;
    }
  }

  const nestedIds = readNestedOnlyExternalIds(query);

  if (nestedIds !== undefined) {
    searchQuery.ids = nestedIds;
  }

  return searchQuery;
}

// EN: Build the public core details query from supported GET /media/details parameters.
// RU: Собирает публичный core details query из поддерживаемых параметров GET /media/details.
export function toDetailsQuery(query: MediaDetailsHttpQuery): DetailsQuery {
  const detailsQuery: DetailsQuery = {};
  const id = readString(query.id);
  const language = readString(query.language);
  const type = readMediaType(query.type);

  if (id !== undefined) {
    detailsQuery.id = id;
  }

  if (language !== undefined) {
    detailsQuery.language = language;
  }

  if (type !== undefined) {
    detailsQuery.type = type;
  }

  for (const key of EXTERNAL_ID_KEYS) {
    const value = readString(query[key] ?? query[`ids.${key}`]);

    if (value !== undefined) {
      detailsQuery[key] = value;
    }
  }

  const nestedIds = readNestedOnlyExternalIds(query);

  if (nestedIds !== undefined) {
    detailsQuery.ids = nestedIds;
  }

  return detailsQuery;
}

// EN: Build the public core streaming query from GET /media/availability parameters.
// RU: Собирает публичный core streaming query из параметров GET /media/availability.
export function toStreamQuery(query: MediaAvailabilityHttpQuery): StreamQuery {
  const streamQuery: Partial<StreamQuery> = {};
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

  if (title !== undefined) {
    streamQuery.title = title;
  }

  if (language !== undefined) {
    streamQuery.language = language;
  }

  if (type !== undefined) {
    streamQuery.type = type;
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

  for (const key of EXTERNAL_ID_KEYS) {
    const value = readString(query[key] ?? query[`ids.${key}`]);

    if (value !== undefined) {
      streamQuery[key] = value;
    }
  }

  const nestedIds = readNestedOnlyExternalIds(query);

  if (nestedIds !== undefined) {
    streamQuery.ids = nestedIds;
  }

  return streamQuery as StreamQuery;
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

// EN: Preserve external IDs that intentionally have no top-level query shortcut.
// RU: Сохраняет внешние ID, для которых намеренно нет верхнеуровневого сокращения.
function readNestedOnlyExternalIds(
  query: Record<string, string | string[] | undefined>,
): SearchQuery['ids'] | undefined {
  const ids: NonNullable<SearchQuery['ids']> = {};

  for (const key of NESTED_ONLY_EXTERNAL_ID_KEYS) {
    const value = readString(query[`ids.${key}`]);

    if (value !== undefined) {
      ids[key] = value;
    }
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
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

  if (MEDIA_TYPES.includes(raw as MediaType)) {
    return raw as MediaType;
  }

  throw new BadRequestException('type must be movie, series, or anime.');
}

// EN: Keep core-to-HTTP error mapping consistent across media endpoints.
// RU: Держит единый mapping ошибок core в HTTP для media endpoints.
async function runEngineRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isMediaEngineError(error, 'INVALID_QUERY')) {
      throw new BadRequestException(error.message);
    }

    if (isMediaEngineError(error, 'PROVIDER_ERROR')) {
      throw new ServiceUnavailableException(error.message);
    }

    throw error;
  }
}

// EN: Detect core engine errors without requiring the ESM-only core package at runtime.
// RU: Определяет ошибки core engine без runtime require ESM-only core package.
function isMediaEngineError(
  error: unknown,
  code: 'INVALID_QUERY' | 'PROVIDER_ERROR',
): error is { message: string } {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const value = error as Record<string, unknown>;

  return (
    value.name === 'MediaEngineError' &&
    value.code === code &&
    typeof value.message === 'string'
  );
}
