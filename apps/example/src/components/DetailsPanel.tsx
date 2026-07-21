import type { AvailabilityMediaInput, MediaSummary } from "../api";
import {
  formatCount,
  formatMediaMeta,
  formatRating,
  formatRuntime,
  formatStatus,
  getEpisodesCount,
} from "../utils/format";
import type { AvailabilityState, DetailsState } from "../state";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { DetailValue, MediaPoster, MetaList } from "./common";
import { EpisodeAvailabilityControls } from "./EpisodeAvailabilityControls";

export function DetailsPanel({
  availabilityState,
  onLoadAvailability,
  state,
}: {
  availabilityState: AvailabilityState;
  onLoadAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
  state: DetailsState;
}) {
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
          <DetailValue label="Status" value={formatStatus(details.status)} />
          <DetailValue label="Episodes" value={formatCount(getEpisodesCount(details))} />
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
                {source.url ? (
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.provider}
                  </a>
                ) : (
                  source.provider
                )}
              </span>
            ))}
            {!details.sourceProviders?.length ? <span className="muted">No sources</span> : null}
          </div>
        </section>

        {details.type === "series" ? (
          <EpisodeAvailabilityControls
            details={details}
            item={state.item}
            loading={availabilityState.status === "loading"}
            onLoadAvailability={onLoadAvailability}
          />
        ) : null}

        <AvailabilitySummary state={availabilityState} />
      </div>
    </aside>
  );
}
