import { ProviderError, type ProviderErrorCode } from "../errors/index.js";
import type { MediaDetails, MediaItem, MediaType } from "../media/index.js";
import type {
  MediaProvider,
  ProviderCapabilities,
  ProviderContext,
  ProviderDetailsQuery,
  ProviderDetailsResult,
  ProviderSearchQuery,
  ProviderSearchResult,
} from "../providers/index.js";
import { sampleMovie } from "./fixtures.js";

// Options used to construct a deterministic mock provider.
// Опции для создания детерминированного mock-провайдера.
export interface MockProviderOptions {
  name?: string;
  version?: string;
  capabilities?: Partial<ProviderCapabilities>;
  searchResults?: ProviderSearchResult[];
  detailsResult?: ProviderDetailsResult | null;
  search?: (
    query: ProviderSearchQuery,
    context: ProviderContext,
  ) => Promise<ProviderSearchResult[]> | ProviderSearchResult[];
  getDetails?: (
    query: ProviderDetailsQuery,
    context: ProviderContext,
  ) => Promise<ProviderDetailsResult | null> | ProviderDetailsResult | null;
}

// Options used to construct a failing mock provider.
// Опции для создания падающего mock-провайдера.
export interface FailingProviderOptions extends MockProviderOptions {
  code?: ProviderErrorCode;
  message?: string;
  retryable?: boolean;
}

// Options used to construct a timeout mock provider.
// Опции для создания mock-провайдера с timeout-сценарием.
export interface TimeoutProviderOptions extends MockProviderOptions {
  delayMs?: number;
}

// Creates a deterministic metadata provider for tests.
// Создает детерминированный metadata-провайдер для тестов.
export function createMockProvider(options: MockProviderOptions = {}): MediaProvider {
  const providerName = options.name ?? "mock-provider";
  const detailsResult = options.detailsResult ?? createDetailsResult(providerName, sampleMovie);
  const searchResults = options.searchResults ?? [createSearchResult(providerName, sampleMovie)];

  return {
    name: providerName,
    version: options.version,
    kind: "metadata",
    capabilities: createCapabilities(options.capabilities),
    async search(query, context) {
      return options.search ? await options.search(query, context) : searchResults;
    },
    async getDetails(query, context) {
      return options.getDetails ? await options.getDetails(query, context) : detailsResult;
    },
  };
}

// Creates a mock provider that always succeeds.
// Создает mock-провайдер, который всегда успешно отвечает.
export function createSuccessProvider(options: MockProviderOptions = {}): MediaProvider {
  return createMockProvider({
    name: "success-provider",
    ...options,
  });
}

// Creates a mock provider that always fails with ProviderError.
// Создает mock-провайдер, который всегда падает с ProviderError.
export function createFailingProvider(options: FailingProviderOptions = {}): MediaProvider {
  const providerName = options.name ?? "failing-provider";
  const error = new ProviderError({
    provider: providerName,
    code: options.code ?? "PROVIDER_ERROR",
    message: options.message ?? "Mock provider failed.",
    retryable: options.retryable ?? false,
  });

  return createMockProvider({
    name: providerName,
    capabilities: options.capabilities,
    async search() {
      throw error;
    },
    async getDetails() {
      throw error;
    },
  });
}

// Creates a mock provider that resolves only after a delay.
// Создает mock-провайдер, который отвечает только после задержки.
export function createTimeoutProvider(options: TimeoutProviderOptions = {}): MediaProvider {
  const providerName = options.name ?? "timeout-provider";
  const delayMs = options.delayMs ?? 60_000;

  return createMockProvider({
    name: providerName,
    capabilities: options.capabilities,
    async search(_, context) {
      await delay(delayMs, context);
      return options.searchResults ?? [createSearchResult(providerName, sampleMovie)];
    },
    async getDetails(_, context) {
      await delay(delayMs, context);
      return options.detailsResult ?? createDetailsResult(providerName, sampleMovie);
    },
  });
}

// Creates a provider search result from a media item or details fixture.
// Создает search result провайдера из media item или details fixture.
export function createSearchResult(
  provider: string,
  item: MediaItem | MediaDetails = sampleMovie,
): ProviderSearchResult {
  return {
    provider,
    item: {
      id: item.id,
      type: item.type,
      title: item.title,
      originalTitle: item.originalTitle,
      alternativeTitles: item.alternativeTitles,
      year: item.year,
      releaseDate: item.releaseDate,
      description: item.description,
      shortDescription: item.shortDescription,
      poster: item.poster,
      backdrop: item.backdrop,
      genres: item.genres,
      ratings: item.ratings,
      ids: item.ids,
    },
    source: {
      provider,
      ids: item.ids,
    },
  };
}

// Creates a provider details result from a details fixture.
// Создает details result провайдера из details fixture.
export function createDetailsResult(
  provider: string,
  details: MediaDetails = sampleMovie,
): ProviderDetailsResult {
  return {
    provider,
    details,
    source: {
      provider,
      ids: details.ids,
    },
  };
}

// Builds provider capabilities with deterministic defaults.
// Создает capabilities провайдера с детерминированными значениями по умолчанию.
function createCapabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    mediaTypes: overrides.mediaTypes ?? (["movie", "series", "anime"] satisfies MediaType[]),
    search: {
      byTitle: overrides.search?.byTitle ?? true,
      byExternalIds: overrides.search?.byExternalIds ?? [
        "imdb",
        "tmdb",
        "shikimori",
        "myAnimeList",
      ],
    },
    details: {
      byExternalIds: overrides.details?.byExternalIds ?? [
        "imdb",
        "tmdb",
        "shikimori",
        "myAnimeList",
      ],
    },
    features: overrides.features,
  };
}

// Waits for a delay and rejects if the provider signal is aborted.
// Ждет задержку и отклоняет promise, если signal провайдера отменен.
function delay(delayMs: number, context: ProviderContext): Promise<void> {
  if (context.signal?.aborted) {
    return Promise.reject(context.signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);

    context.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(context.signal?.reason);
      },
      { once: true },
    );
  });
}
