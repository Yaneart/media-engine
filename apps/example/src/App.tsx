import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { getMediaDetails, searchMedia } from "./api";
import type {
  DetailsResponse,
  ExternalIds,
  MediaSummary,
  SearchFormQuery,
  SearchResponse,
} from "./api";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: SearchResponse }
  | { status: "empty"; response: SearchResponse }
  | { status: "error"; message: string };

type DetailsState =
  | { status: "idle" }
  | { status: "loading"; item: MediaSummary }
  | { status: "success"; item: MediaSummary; response: DetailsResponse }
  | { status: "empty"; item: MediaSummary }
  | { status: "error"; item?: MediaSummary; message: string };

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
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const detailsAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      searchAbortControllerRef.current?.abort();
      detailsAbortControllerRef.current?.abort();
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

    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setSearchState({ status: "loading" });
    setDetailsState({ status: "idle" });

    try {
      const response = await searchMedia(
        {
          ...query,
          title,
        },
        abortController.signal,
      );

      setSearchState(
        response.results.length > 0
          ? { status: "success", response }
          : { status: "empty", response },
      );
    } catch (error) {
      if (abortController.signal.aborted) {
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
      setDetailsState({
        status: "error",
        item,
        message: "This result does not include external IDs for details lookup.",
      });
      return;
    }

    detailsAbortControllerRef.current?.abort();

    const abortController = new AbortController();
    detailsAbortControllerRef.current = abortController;

    setDetailsState({
      status: "loading",
      item,
    });

    try {
      const response = await getMediaDetails(item, abortController.signal);

      setDetailsState(
        response.details ? { status: "success", item, response } : { status: "empty", item },
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      setDetailsState({
        status: "error",
        item,
        message: error instanceof Error ? error.message : "Details request failed.",
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
          <DetailsPanel state={detailsState} />
        </div>
      </section>
    </main>
  );
}

function SearchPanel({
  onDetails,
  state,
}: {
  onDetails: (item: MediaSummary) => void;
  state: SearchState;
}) {
  if (state.status === "idle") {
    return (
      <section className="state-panel" aria-live="polite">
        <strong>Ready</strong>
        <span>No search has been submitted.</span>
      </section>
    );
  }

  if (state.status === "loading") {
    return (
      <section className="state-panel state-panel--loading" aria-live="polite">
        <strong>Searching</strong>
        <span>Waiting for provider responses.</span>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="state-panel state-panel--error" aria-live="assertive">
        <strong>Error</strong>
        <span>{state.message}</span>
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section className="state-panel" aria-live="polite">
        <strong>No results</strong>
        <span>Try a different title or media type.</span>
      </section>
    );
  }

  return (
    <section className="results" aria-live="polite">
      <div className="results__summary">
        <strong>{state.response.results.length} results</strong>
        <span>{state.response.meta.tookMs} ms</span>
      </div>

      <ul className="results__list">
        {state.response.results.map((result) => (
          <li className="result-card" key={result.item.id}>
            <MediaPoster item={result.item} />
            <div className="result-card__body">
              <div className="result-card__heading">
                <strong>{result.item.title}</strong>
                <span>{formatMediaMeta(result.item)}</span>
              </div>

              <MetaList ids={result.item.ids} />

              <div className="chips">
                {result.item.genres?.slice(0, 3).map((genre) => (
                  <span className="chip" key={genre.name}>
                    {genre.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="result-card__aside">
              <span>{formatRating(result.item.ratings)}</span>
              <span>{result.sources.map((source) => source.provider).join(", ")}</span>
              <button
                className="details-button"
                onClick={() => onDetails(result.item)}
                type="button"
              >
                Details
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetailsPanel({ state }: { state: DetailsState }) {
  if (state.status === "idle") {
    return (
      <aside className="details-panel">
        <strong>Details</strong>
        <span>Select a result to load merged metadata.</span>
      </aside>
    );
  }

  if (state.status === "loading") {
    return (
      <aside className="details-panel details-panel--loading" aria-live="polite">
        <strong>{state.item.title}</strong>
        <span>Loading details.</span>
      </aside>
    );
  }

  if (state.status === "empty") {
    return (
      <aside className="details-panel" aria-live="polite">
        <strong>{state.item.title}</strong>
        <span>No details returned by configured providers.</span>
      </aside>
    );
  }

  if (state.status === "error") {
    return (
      <aside className="details-panel details-panel--error" aria-live="assertive">
        <strong>{state.item?.title ?? "Details error"}</strong>
        <span>{state.message}</span>
      </aside>
    );
  }

  const details = state.response.details;

  if (!details) {
    return null;
  }

  return (
    <aside className="details-panel details-panel--loaded" aria-live="polite">
      <MediaPoster item={details} size="large" />

      <div className="details-panel__content">
        <div>
          <strong>{details.title}</strong>
          <span>{formatMediaMeta(details)}</span>
        </div>

        <p>{details.description ?? details.shortDescription ?? "No description available."}</p>

        <div className="details-grid">
          <DetailValue label="Rating" value={formatRating(details.ratings)} />
          <DetailValue label="Runtime" value={formatRuntime(details.runtimeMinutes)} />
          <DetailValue label="Status" value={details.status} />
          <DetailValue label="Episodes" value={formatCount(details.episodesCount)} />
        </div>

        <section className="detail-section">
          <span>Genres</span>
          <div className="chips">
            {details.genres?.length ? (
              details.genres.map((genre) => (
                <span className="chip" key={genre.name}>
                  {genre.name}
                </span>
              ))
            ) : (
              <span className="muted">No genres</span>
            )}
          </div>
        </section>

        <section className="detail-section">
          <span>External IDs</span>
          <MetaList ids={details.ids} />
        </section>

        <section className="detail-section">
          <span>Sources</span>
          <div className="chips">
            {(details.sourceProviders ?? []).map((source) => (
              <span className="chip" key={source.provider}>
                {source.provider}
              </span>
            ))}
            {!details.sourceProviders?.length ? <span className="muted">No sources</span> : null}
          </div>
        </section>
      </div>
    </aside>
  );
}

function MediaPoster({
  item,
  size = "regular",
}: {
  item: MediaSummary;
  size?: "regular" | "large";
}) {
  return (
    <div className={`poster poster--${size}`}>
      {item.poster?.url ? <img alt="" src={item.poster.url} /> : <span>{item.type}</span>}
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="detail-value">
      <span>{label}</span>
      <strong>{value ?? "Unknown"}</strong>
    </div>
  );
}

function MetaList({ ids }: { ids?: ExternalIds }) {
  const entries = Object.entries(ids ?? {}).filter(([, value]) => Boolean(value));

  if (entries.length === 0) {
    return <span className="muted">No external IDs</span>;
  }

  return (
    <div className="meta-list">
      {entries.slice(0, 4).map(([key, value]) => (
        <span key={key}>
          {key}: {value}
        </span>
      ))}
    </div>
  );
}

function hasDetailsLookup(item: MediaSummary): boolean {
  return Boolean(item.ids && Object.values(item.ids).some((value) => Boolean(value)));
}

function formatMediaMeta(item: MediaSummary): string {
  return [item.type, item.year].filter(Boolean).join(" · ");
}

function formatRating(ratings: MediaSummary["ratings"]): string {
  const rating = ratings?.[0];

  return rating ? `${rating.value}/${rating.max} ${rating.source}` : "No rating";
}

function formatRuntime(runtimeMinutes: number | undefined): string | undefined {
  return runtimeMinutes ? `${runtimeMinutes} min` : undefined;
}

function formatCount(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export default App;
