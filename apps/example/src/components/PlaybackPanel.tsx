import { useState } from "react";
import type { AvailabilityMediaInput, MediaDetails, MediaSummary } from "../api";
import type { AvailabilityState } from "../state";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { EpisodeAvailabilityControls } from "./EpisodeAvailabilityControls";
import { TorrentPlaybackPanel } from "./TorrentPlaybackPanel";

export function PlaybackPanel({
  availabilityState,
  details,
  item,
  onLoadAvailability,
}: {
  availabilityState: AvailabilityState;
  details: MediaDetails;
  item: MediaSummary;
  onLoadAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"online" | "torrent">("online");
  const onlineCount =
    availabilityState.status === "success" || availabilityState.status === "empty"
      ? availabilityState.response.options.length
      : undefined;

  return (
    <section className="playback-panel" aria-labelledby="playback-heading">
      <div className="playback-panel__heading">
        <div>
          <span className="section-kicker">Playback</span>
          <strong id="playback-heading">Playback sources</strong>
        </div>
        <span className="muted">Online or original bytes</span>
      </div>

      <div className="playback-tabs" role="tablist" aria-label="Playback source">
        <button
          aria-selected={mode === "online"}
          className="playback-tab"
          onClick={() => setMode("online")}
          role="tab"
          type="button"
        >
          Online players
          <PlaybackCount count={onlineCount} loading={availabilityState.status === "loading"} />
        </button>
        <button
          aria-selected={mode === "torrent"}
          className="playback-tab"
          onClick={() => setMode("torrent")}
          role="tab"
          type="button"
        >
          Torrent player
        </button>
      </div>

      <div className="playback-panel__body">
        {mode === "online" ? (
          <>
            <div className="playback-mode__intro">
              <strong>Choose a provider</strong>
              <span>Select a voiceover and available quality.</span>
            </div>
            {details.type === "series" ? (
              <EpisodeAvailabilityControls
                details={details}
                item={item}
                loading={availabilityState.status === "loading"}
                onLoadAvailability={onLoadAvailability}
              />
            ) : null}
            <AvailabilitySummary state={availabilityState} />
          </>
        ) : (
          <TorrentPlaybackPanel details={details} />
        )}
      </div>
    </section>
  );
}

function PlaybackCount({ count, loading }: { count?: number; loading: boolean }) {
  return (
    <span className="playback-tab__count" aria-hidden="true">
      {loading ? "…" : (count ?? "—")}
    </span>
  );
}
