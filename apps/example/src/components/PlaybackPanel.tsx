import { useState } from "react";
import type { AvailabilityMediaInput, MediaDetails, MediaSummary, TorrentMediaInput } from "../api";
import type { AvailabilityState, TorrentState } from "../state";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { EpisodeAvailabilityControls } from "./EpisodeAvailabilityControls";
import { TorrentDiscoveryControls } from "./TorrentDiscoveryControls";
import { TorrentSummary } from "./TorrentSummary";

type PlaybackMode = "online" | "torrent";

export function PlaybackPanel({
  availabilityState,
  details,
  item,
  onDiscoverTorrents,
  onLoadAvailability,
  torrentState,
}: {
  availabilityState: AvailabilityState;
  details: MediaDetails;
  item: MediaSummary;
  onDiscoverTorrents: (item: MediaSummary, torrentItem?: TorrentMediaInput) => Promise<void>;
  onLoadAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
  torrentState: TorrentState;
}) {
  const [mode, setMode] = useState<PlaybackMode>("online");
  const onlineCount =
    availabilityState.status === "success" || availabilityState.status === "empty"
      ? availabilityState.response.options.length
      : undefined;
  const torrentCount =
    torrentState.status === "success" || torrentState.status === "empty"
      ? torrentState.response.candidates.length
      : undefined;

  return (
    <section className="playback-panel" aria-labelledby="playback-heading">
      <div className="playback-panel__heading">
        <div>
          <span className="section-kicker">Playback</span>
          <strong id="playback-heading">Choose how to watch</strong>
        </div>
        <span className="muted">Online sources and torrents are kept separate.</span>
      </div>

      <div className="playback-tabs" role="tablist" aria-label="Playback mode">
        <button
          aria-controls="online-playback-panel"
          aria-selected={mode === "online"}
          className="playback-tab"
          id="online-playback-tab"
          onClick={() => setMode("online")}
          role="tab"
          type="button"
        >
          <span>Online players</span>
          <PlaybackCount count={onlineCount} loading={availabilityState.status === "loading"} />
        </button>
        <button
          aria-controls="torrent-playback-panel"
          aria-selected={mode === "torrent"}
          className="playback-tab"
          id="torrent-playback-tab"
          onClick={() => setMode("torrent")}
          role="tab"
          type="button"
        >
          <span>Torrent player</span>
          <PlaybackCount count={torrentCount} loading={torrentState.status === "loading"} />
        </button>
      </div>

      {mode === "online" ? (
        <div
          aria-labelledby="online-playback-tab"
          className="playback-panel__body"
          id="online-playback-panel"
          role="tabpanel"
        >
          <div className="playback-mode__intro">
            <strong>Online players</strong>
            <span>Choose a provider, voiceover and available quality.</span>
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
      ) : (
        <div
          aria-labelledby="torrent-playback-tab"
          className="playback-panel__body"
          id="torrent-playback-panel"
          role="tabpanel"
        >
          <div className="playback-mode__intro">
            <strong>Torrent player</strong>
            <span>Find a release, inspect its availability and start a private session.</span>
          </div>
          <TorrentDiscoveryControls
            details={details}
            item={item}
            loading={torrentState.status === "loading"}
            onDiscover={onDiscoverTorrents}
          />
          <TorrentSummary
            key={
              torrentState.status === "success" || torrentState.status === "empty"
                ? torrentState.response.checkedAt
                : torrentState.status
            }
            state={torrentState}
          />
        </div>
      )}
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
