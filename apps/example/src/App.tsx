import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { getMediaAvailability, getMediaDetails, searchMedia } from "./api";
import { DetailsPanel, SearchPanel } from "./components";
import { hasDetailsLookup } from "./utils/format";
import type { AvailabilityMediaInput, MediaSummary, SearchFormQuery } from "./api";
import type { AvailabilityState, DetailsState, SearchState } from "./state";

const PRIMARY_STREAMING_PROVIDERS = [
  "videohub-streaming",
  "veoveo-streaming",
  "filmix-streaming",
  "aniliberty-streaming",
];
const EMBED_STREAMING_PROVIDERS = [
  "rutube-streaming",
  "kinobd-streaming",
  "flixhq-streaming",
  "ddbb-streaming",
];

// EN: Root React component for the Media Engine example application shell.
// RU: Корневой React component для оболочки example приложения Media Engine.
function App() {
  const [query, setQuery] = useState<SearchFormQuery>({
    title: "",
    type: "",
  });
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const [detailsState, setDetailsState] = useState<DetailsState>({
    status: "idle",
  });
  const [primaryAvailabilityState, setPrimaryAvailabilityState] = useState<AvailabilityState>({
    status: "idle",
  });
  const [embedAvailabilityState, setEmbedAvailabilityState] = useState<AvailabilityState>({
    status: "idle",
  });
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const detailsAbortControllerRef = useRef<AbortController | null>(null);
  const availabilityAbortControllerRef = useRef<AbortController | null>(null);
  const embedAvailabilityAbortControllerRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const detailsRequestIdRef = useRef(0);
  const availabilityRequestIdRef = useRef(0);
  const embedAvailabilityRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      searchAbortControllerRef.current?.abort();
      detailsAbortControllerRef.current?.abort();
      availabilityAbortControllerRef.current?.abort();
      embedAvailabilityAbortControllerRef.current?.abort();
    };
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = query.title.trim();

    if (!title) {
      setSearchState({
        status: "error",
        message: "Enter a title to search.",
      });
      return;
    }

    searchAbortControllerRef.current?.abort();
    detailsAbortControllerRef.current?.abort();
    availabilityAbortControllerRef.current?.abort();
    embedAvailabilityAbortControllerRef.current?.abort();
    detailsRequestIdRef.current += 1;
    availabilityRequestIdRef.current += 1;
    embedAvailabilityRequestIdRef.current += 1;

    const abortController = new AbortController();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    searchAbortControllerRef.current = abortController;

    setSearchState({ status: "loading" });
    setDetailsState({ status: "idle" });
    setPrimaryAvailabilityState({ status: "idle" });
    setEmbedAvailabilityState({ status: "idle" });

    try {
      const response = await searchMedia(
        {
          ...query,
          title,
        },
        abortController.signal,
      );

      if (abortController.signal.aborted || requestId !== searchRequestIdRef.current) {
        return;
      }

      setSearchState(
        response.results.length > 0
          ? { status: "success", response }
          : { status: "empty", response },
      );
    } catch (error) {
      if (abortController.signal.aborted || requestId !== searchRequestIdRef.current) {
        return;
      }

      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Search request failed.",
      });
    }
  }

  async function handleDetails(item: MediaSummary) {
    if (!hasDetailsLookup(item)) {
      detailsAbortControllerRef.current?.abort();
      availabilityAbortControllerRef.current?.abort();
      embedAvailabilityAbortControllerRef.current?.abort();
      detailsRequestIdRef.current += 1;
      availabilityRequestIdRef.current += 1;
      embedAvailabilityRequestIdRef.current += 1;
      setDetailsState({
        status: "error",
        item,
        message: "This result does not include external IDs for details lookup.",
      });
      setPrimaryAvailabilityState({ status: "idle" });
      setEmbedAvailabilityState({ status: "idle" });
      return;
    }

    detailsAbortControllerRef.current?.abort();
    availabilityAbortControllerRef.current?.abort();
    embedAvailabilityAbortControllerRef.current?.abort();
    availabilityRequestIdRef.current += 1;
    embedAvailabilityRequestIdRef.current += 1;

    const abortController = new AbortController();
    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;
    detailsAbortControllerRef.current = abortController;

    setDetailsState({
      status: "loading",
      item,
    });
    setPrimaryAvailabilityState({
      status: "loading",
      item,
    });
    setEmbedAvailabilityState({ status: "idle" });

    try {
      const response = await getMediaDetails(item, abortController.signal);

      if (abortController.signal.aborted || requestId !== detailsRequestIdRef.current) {
        return;
      }

      setDetailsState(
        response.details ? { status: "success", item, response } : { status: "empty", item },
      );

      if (!response.details || abortController.signal.aborted) {
        setPrimaryAvailabilityState({ status: "idle" });
        return;
      }

      await loadPrimaryAvailability(item, response.details);
    } catch (error) {
      if (abortController.signal.aborted || requestId !== detailsRequestIdRef.current) {
        return;
      }

      setDetailsState({
        status: "error",
        item,
        message: error instanceof Error ? error.message : "Details request failed.",
      });
      setPrimaryAvailabilityState({
        status: "idle",
      });
    }
  }

  async function loadPrimaryAvailability(
    item: MediaSummary,
    availabilityItem: AvailabilityMediaInput = item,
  ) {
    const abortController = new AbortController();
    const requestId = availabilityRequestIdRef.current + 1;
    availabilityRequestIdRef.current = requestId;
    availabilityAbortControllerRef.current = abortController;

    try {
      const response = await getMediaAvailability(
        availabilityItem,
        PRIMARY_STREAMING_PROVIDERS,
        abortController.signal,
      );

      if (abortController.signal.aborted || requestId !== availabilityRequestIdRef.current) {
        return;
      }

      setPrimaryAvailabilityState(
        response.options.length > 0
          ? { status: "success", item, response }
          : { status: "empty", item, response },
      );
    } catch (error) {
      if (abortController.signal.aborted || requestId !== availabilityRequestIdRef.current) {
        return;
      }

      setPrimaryAvailabilityState({
        status: "error",
        item,
        message: error instanceof Error ? error.message : "Availability request failed.",
      });
    }
  }

  async function loadEmbedAvailability(
    item: MediaSummary,
    availabilityItem: AvailabilityMediaInput = item,
  ) {
    embedAvailabilityAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    const requestId = embedAvailabilityRequestIdRef.current + 1;
    embedAvailabilityRequestIdRef.current = requestId;
    embedAvailabilityAbortControllerRef.current = abortController;
    setEmbedAvailabilityState({ status: "loading", item });

    try {
      const response = await getMediaAvailability(
        availabilityItem,
        EMBED_STREAMING_PROVIDERS,
        abortController.signal,
      );
      if (abortController.signal.aborted || requestId !== embedAvailabilityRequestIdRef.current) {
        return;
      }
      setEmbedAvailabilityState(
        response.options.length > 0
          ? { status: "success", item, response }
          : { status: "empty", item, response },
      );
    } catch (error) {
      if (abortController.signal.aborted || requestId !== embedAvailabilityRequestIdRef.current) {
        return;
      }
      setEmbedAvailabilityState({
        status: "error",
        item,
        message: error instanceof Error ? error.message : "Embed availability request failed.",
      });
    }
  }

  return (
    <main className="app-shell">
      <section className="overview" aria-labelledby="app-title">
        <div className="overview__heading">
          <p className="overview__eyebrow">Media Engine</p>
          <h1 id="app-title">Metadata Search</h1>
        </div>

        <form className="search-form" onSubmit={handleSearch}>
          <label className="field field--title">
            <span>Title</span>
            <input
              autoComplete="off"
              name="title"
              onChange={(event) =>
                setQuery((currentQuery) => ({
                  ...currentQuery,
                  title: event.target.value,
                }))
              }
              placeholder="Interstellar"
              value={query.title}
            />
          </label>

          <label className="field">
            <span>Type</span>
            <select
              name="type"
              onChange={(event) =>
                setQuery((currentQuery) => ({
                  ...currentQuery,
                  type: event.target.value as SearchFormQuery["type"],
                }))
              }
              value={query.type}
            >
              <option value="">Any</option>
              <option value="movie">Movie</option>
              <option value="series">Series</option>
              <option value="anime">Anime</option>
            </select>
          </label>

          <button
            className="search-button"
            disabled={searchState.status === "loading"}
            type="submit"
          >
            {searchState.status === "loading" ? "Searching" : "Search"}
          </button>
        </form>

        <div className="workspace">
          <SearchPanel onDetails={handleDetails} state={searchState} />
          <DetailsPanel
            embedAvailabilityState={embedAvailabilityState}
            onLoadEmbedAvailability={loadEmbedAvailability}
            onLoadPrimaryAvailability={loadPrimaryAvailability}
            primaryAvailabilityState={primaryAvailabilityState}
            state={detailsState}
          />
        </div>
      </section>
    </main>
  );
}

export default App;
