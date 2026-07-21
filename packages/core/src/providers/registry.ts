import type { ExternalIds } from "../media/index.js";
import type {
  ExternalIdSource,
  MediaProvider,
  ProviderDetailsQuery,
  ProviderInfo,
  ProviderSearchQuery,
  TitleDiscoveryRole,
} from "./types.js";

const EXTERNAL_ID_SOURCES: ExternalIdSource[] = [
  "imdb",
  "tmdb",
  "kinopoisk",
  "shikimori",
  "myAnimeList",
  "aniList",
  "worldArt",
];

// Registry for provider registration and capability-based selection.
// Реестр для регистрации провайдеров и выбора по их возможностям.
export class ProviderRegistry {
  private readonly providers = new Map<string, MediaProvider>();

  constructor(providers: MediaProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  // Registers one provider and rejects duplicate stable names.
  // Регистрирует одного провайдера и запрещает повторяющиеся стабильные имена.
  register(provider: MediaProvider): void {
    const name = provider.name.trim();

    if (!name) {
      throw new Error("Provider name is required.");
    }

    if (name !== provider.name) {
      throw new Error(
        `Provider name "${provider.name}" must not include leading or trailing whitespace.`,
      );
    }

    if (this.providers.has(provider.name)) {
      throw new Error(`Provider with name "${provider.name}" is already registered.`);
    }

    this.providers.set(provider.name, provider);
  }

  // Returns safe provider metadata without provider internals or secrets.
  // Возвращает безопасные метаданные провайдеров без внутренних данных и секретов.
  getProviders(): ProviderInfo[] {
    return Array.from(this.providers.values()).map((provider) => ({
      name: provider.name,
      version: provider.version,
      kind: provider.kind,
      capabilities: {
        mediaTypes: [...provider.capabilities.mediaTypes],
        ...(provider.capabilities.searchEnrichment !== undefined
          ? { searchEnrichment: provider.capabilities.searchEnrichment }
          : {}),
        search: {
          byTitle: provider.capabilities.search.byTitle,
          byExternalIds: [...provider.capabilities.search.byExternalIds],
          ...(provider.capabilities.search.titleDiscovery
            ? { titleDiscovery: provider.capabilities.search.titleDiscovery }
            : {}),
        },
        details: {
          byExternalIds: [...provider.capabilities.details.byExternalIds],
        },
        features: provider.capabilities.features ? [...provider.capabilities.features] : undefined,
      },
    }));
  }

  // Selects providers that can handle a normalized search query.
  // Выбирает провайдеров, которые могут обработать нормализованный поисковый запрос.
  selectSearchProviders(
    query: ProviderSearchQuery,
    options: { titleDiscovery?: TitleDiscoveryRole } = {},
  ): MediaProvider[] {
    const queryIdSources = getExternalIdSources(query.ids);

    return Array.from(this.providers.values()).filter((provider) => {
      if (query.type && !provider.capabilities.mediaTypes.includes(query.type)) {
        return false;
      }

      const providerTitleDiscovery = provider.capabilities.search.titleDiscovery ?? "primary";
      const supportsTitleSearch =
        Boolean(query.title?.trim()) &&
        provider.capabilities.search.byTitle &&
        (!options.titleDiscovery || options.titleDiscovery === providerTitleDiscovery);

      const supportsIdSearch = queryIdSources.some((source) =>
        provider.capabilities.search.byExternalIds.includes(source),
      );

      return supportsTitleSearch || supportsIdSearch;
    });
  }

  // Selects providers that can handle a normalized details query.
  // Выбирает провайдеров, которые могут обработать нормализованный запрос деталей.
  selectDetailsProviders(query: ProviderDetailsQuery): MediaProvider[] {
    const queryIdSources = getExternalIdSources(query.ids);

    return Array.from(this.providers.values()).filter((provider) => {
      if (!provider.getDetails) {
        return false;
      }

      if (
        query.type &&
        !provider.capabilities.mediaTypes.includes(query.type) &&
        !(query.type === "anime" && provider.capabilities.mediaTypes.includes("series"))
      ) {
        return false;
      }

      return queryIdSources.some((source) =>
        provider.capabilities.details.byExternalIds.includes(source),
      );
    });
  }
}

// Extracts present external ID sources from an ExternalIds object.
// Достает присутствующие источники внешних ID из объекта ExternalIds.
function getExternalIdSources(ids: ExternalIds | undefined): ExternalIdSource[] {
  if (!ids) {
    return [];
  }

  return EXTERNAL_ID_SOURCES.filter((source) => Boolean(ids[source]));
}
