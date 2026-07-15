import type { MediaSummary } from "../api";
import { formatMediaMeta, formatRating } from "../utils/format";
import type { SearchState } from "../state";
import { MediaPoster, MetaList } from "./common";

export function SearchPanel({
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
