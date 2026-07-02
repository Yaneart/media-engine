import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MediaEngineError,
  type MediaEngine,
  type MediaType,
  type SearchQuery,
  type SearchResponse,
} from '@media-engine/core';
import { MEDIA_ENGINE } from '../media-engine';

// EN: Raw query shape received from HTTP before API-level normalization.
// RU: Сырая форма query из HTTP до нормализации на уровне API.
export type MediaSearchHttpQuery = Record<
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

@Injectable()
// EN: Application service that adapts HTTP search requests to the core engine.
// RU: Сервис приложения, который адаптирует HTTP search запросы к core engine.
export class MediaSearchService {
  constructor(
    @Inject(MEDIA_ENGINE)
    private readonly mediaEngine: MediaEngine,
  ) {}

  // EN: Convert HTTP query parameters into a core SearchQuery and run search.
  // RU: Преобразует HTTP query параметры в core SearchQuery и запускает поиск.
  async search(query: MediaSearchHttpQuery): Promise<SearchResponse> {
    try {
      return await this.mediaEngine.search(toSearchQuery(query));
    } catch (error) {
      if (error instanceof MediaEngineError && error.code === 'INVALID_QUERY') {
        throw new BadRequestException(error.message);
      }

      if (
        error instanceof MediaEngineError &&
        error.code === 'PROVIDER_ERROR'
      ) {
        throw new ServiceUnavailableException(error.message);
      }

      throw error;
    }
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

  return searchQuery;
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
