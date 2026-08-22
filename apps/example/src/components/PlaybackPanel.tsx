import { useState } from "react";
import type { AvailabilityMediaInput, MediaDetails, MediaSummary } from "../api";
import type { AvailabilityState } from "../state";
import { getAvailabilityOptions, groupEmbedPlayers } from "../utils/format";
import { EmbedPlayerPanel } from "./EmbedPlayerPanel";
import { EpisodeAvailabilityControls } from "./EpisodeAvailabilityControls";
import { PrimaryPlayerPanel } from "./PrimaryPlayerPanel";
import { TorrentPlaybackPanel } from "./TorrentPlaybackPanel";

export function PlaybackPanel({
  details,
  embedAvailabilityState,
  item,
  onLoadEmbedAvailability,
  onLoadPrimaryAvailability,
  primaryAvailabilityState,
}: {
  details: MediaDetails;
  embedAvailabilityState: AvailabilityState;
  item: MediaSummary;
  onLoadEmbedAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
  onLoadPrimaryAvailability: (
    item: MediaSummary,
    availabilityItem?: AvailabilityMediaInput,
  ) => Promise<void>;
  primaryAvailabilityState: AvailabilityState;
}) {
  const [mode, setMode] = useState<"primary" | "embed" | "torrent">("primary");
  const primaryOptions = getAvailabilityOptions(primaryAvailabilityState);
  const embedOptions = getAvailabilityOptions(embedAvailabilityState);
  const primaryCount = primaryOptions.filter((option) =>
    ["hls", "mp4"].includes(option.player.kind),
  ).length;
  const embedCount = groupEmbedPlayers(embedOptions).length;

  function showEmbedPlayers() {
    setMode("embed");
    if (embedAvailabilityState.status === "idle") {
      void onLoadEmbedAvailability(item, details);
    }
  }

  return (
    <section className="playback-panel" aria-labelledby="playback-heading">
      <div className="playback-panel__heading">
        <div>
          <span className="section-kicker">Просмотр</span>
          <strong id="playback-heading">Выберите способ просмотра</strong>
        </div>
        <span className="muted">Три режима без смешивания источников</span>
      </div>

      <div className="playback-tabs" role="tablist" aria-label="Способ просмотра">
        <button
          aria-selected={mode === "primary"}
          className="playback-tab"
          onClick={() => setMode("primary")}
          role="tab"
          type="button"
        >
          Основной плеер
          <PlaybackCount
            count={primaryCount}
            loading={primaryAvailabilityState.status === "loading"}
          />
        </button>
        <button
          aria-selected={mode === "embed"}
          className="playback-tab"
          onClick={showEmbedPlayers}
          role="tab"
          type="button"
        >
          Embed плеер
          <PlaybackCount
            count={embedAvailabilityState.status === "idle" ? undefined : embedCount}
            loading={embedAvailabilityState.status === "loading"}
          />
        </button>
        <button
          aria-selected={mode === "torrent"}
          className="playback-tab"
          onClick={() => setMode("torrent")}
          role="tab"
          type="button"
        >
          Torrent плеер
        </button>
      </div>

      <div className="playback-panel__body">
        {mode === "primary" ? (
          <>
            <div className="playback-mode__intro">
              <strong>Основной плеер</strong>
              <span>Сначала выберите серию, затем озвучку и качество.</span>
            </div>
            {details.type === "series" || details.type === "anime" ? (
              <EpisodeAvailabilityControls
                details={details}
                item={item}
                loading={primaryAvailabilityState.status === "loading"}
                onLoadAvailability={onLoadPrimaryAvailability}
              />
            ) : null}
            <PrimaryPlayerPanel details={details} state={primaryAvailabilityState} />
          </>
        ) : mode === "embed" ? (
          <>
            <div className="playback-mode__intro">
              <strong>Embed плееры</strong>
              <span>Выберите плеер. Озвучка, серия и качество настраиваются внутри него.</span>
            </div>
            <EmbedPlayerPanel state={embedAvailabilityState} />
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
