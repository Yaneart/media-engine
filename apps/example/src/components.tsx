import { useState } from "react";
import type { FormEvent } from "react";
import type { AvailabilityMediaInput, ExternalIds, MediaDetails, MediaSummary } from "./api";
import {
  formatCount,
  formatMediaMeta,
  formatPlayerMeta,
  formatProviderFailure,
  formatRating,
  formatRuntime,
  formatStatus,
  getAvailabilityOptions,
  getEpisodesCount,
  groupAvailabilityOptions,
} from "./format";
import type { AvailabilityOption, AvailabilityState, DetailsState, SearchState } from "./state";

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
                {source.provider}
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

function EpisodeAvailabilityControls({
  details,
  item,
  loading,
  onLoadAvailability,
}: {
  details: MediaDetails;
  item: MediaSummary;
  loading: boolean;
  onLoadAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
}) {
  const [seasonNumber, setSeasonNumber] = useState("1");
  const [episodeNumber, setEpisodeNumber] = useState("1");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const episode = Number.parseInt(episodeNumber, 10);
    const season = Number.parseInt(seasonNumber, 10);

    if (!Number.isInteger(episode) || episode <= 0 || !Number.isInteger(season) || season <= 0) {
      return;
    }

    void onLoadAvailability(item, {
      ...details,
      seasonNumber: season,
      episodeNumber: episode,
    });
  }

  return (
    <form className="episode-picker" onSubmit={handleSubmit}>
      <span>Episode selection</span>
      <div className="episode-picker__fields">
        <label className="field">
          <span>Season</span>
          <input
            min="1"
            onChange={(event) => setSeasonNumber(event.target.value)}
            type="number"
            value={seasonNumber}
          />
        </label>
        <label className="field">
          <span>Episode</span>
          <input
            min="1"
            onChange={(event) => setEpisodeNumber(event.target.value)}
            type="number"
            value={episodeNumber}
          />
        </label>
        <button className="details-button" disabled={loading} type="submit">
          {loading ? "Loading..." : "Load players"}
        </button>
      </div>
      <span className="muted">Optional: load players for a specific episode.</span>
    </form>
  );
}

function AvailabilitySummary({ state }: { state: AvailabilityState }) {
  const options = getAvailabilityOptions(state);
  const optionGroups = groupAvailabilityOptions(options);
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? options[0];

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <section className="detail-section" aria-live="polite">
        <span>Players</span>
        <span className="muted">Loading player options.</span>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="detail-section" aria-live="assertive">
        <span>Players</span>
        <span className="muted">{state.message}</span>
      </section>
    );
  }

  const failedCount = state.response.meta?.providers.failed.length ?? 0;
  const failedProviders = state.response.meta?.providers.failed ?? [];

  return (
    <section className="detail-section" aria-live="polite">
      <span>Players</span>
      <span className="muted">
        {state.response.options.length > 0
          ? `${state.response.options.length} options available`
          : "No player options returned."}
        {failedCount > 0 ? ` ${failedCount} provider failures.` : ""}
      </span>
      {failedProviders.length > 0 ? (
        <ul className="provider-failures">
          {failedProviders.map((failure) => (
            <li key={`${failure.provider}:${failure.code}`}>{formatProviderFailure(failure)}</li>
          ))}
        </ul>
      ) : null}
      {options.length > 0 ? (
        <div className="player-groups">
          {optionGroups.map((group) => (
            <section className="player-group" key={group.label}>
              <div className="player-group__heading">
                <span>{group.label}</span>
                <span>{group.options.length}</span>
              </div>
              <ul className="player-list">
                {group.options.map((option) => (
                  <li className="player-option" key={option.id}>
                    <div className="player-option__main">
                      <strong>{option.player.label}</strong>
                      <span>{formatPlayerMeta(option)}</span>
                    </div>
                    <button
                      className="player-option__action"
                      onClick={() => setSelectedOptionId(option.id)}
                      type="button"
                    >
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {selectedOption ? <PlayerPreview option={selectedOption} /> : null}
    </section>
  );
}

function PlayerPreview({ option }: { option: AvailabilityOption }) {
  if (option.player.kind === "external") {
    return (
      <div className="player-preview">
        <strong>{option.player.label}</strong>
        <a href={option.access.url} rel="noreferrer" target="_blank">
          Open external player
        </a>
      </div>
    );
  }

  if (option.player.kind !== "embed") {
    return (
      <div className="player-preview">
        <strong>{option.player.label}</strong>
        <a href={option.access.url} rel="noreferrer" target="_blank">
          Open stream
        </a>
      </div>
    );
  }

  return (
    <div className="player-preview">
      <strong>{option.player.label}</strong>
      <iframe
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        src={option.access.url}
        title={`${option.player.label} player`}
      />
    </div>
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
      <strong>{value ?? "Not available"}</strong>
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
