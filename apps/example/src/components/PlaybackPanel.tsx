import type { AvailabilityMediaInput, MediaDetails, MediaSummary } from "../api";
import type { AvailabilityState } from "../state";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { EpisodeAvailabilityControls } from "./EpisodeAvailabilityControls";

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
  const onlineCount =
    availabilityState.status === "success" || availabilityState.status === "empty"
      ? availabilityState.response.options.length
      : undefined;

  return (
    <section className="playback-panel" aria-labelledby="playback-heading">
      <div className="playback-panel__heading">
        <div>
          <span className="section-kicker">Playback</span>
          <strong id="playback-heading">Online players</strong>
        </div>
        <PlaybackCount count={onlineCount} loading={availabilityState.status === "loading"} />
      </div>

      <div className="playback-panel__body">
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
