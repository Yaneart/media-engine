import { useState } from "react";
import type { FormEvent } from "react";
import type { AvailabilityMediaInput, MediaDetails, MediaSummary } from "../api";

export function EpisodeAvailabilityControls({
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
