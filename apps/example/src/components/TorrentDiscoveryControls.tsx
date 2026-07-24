import { useState } from "react";
import type { FormEvent } from "react";
import type { MediaDetails, MediaSummary, TorrentMediaInput } from "../api";

export function TorrentDiscoveryControls({
  details,
  item,
  loading,
  onDiscover,
}: {
  details: MediaDetails;
  item: MediaSummary;
  loading: boolean;
  onDiscover: (item: MediaSummary, torrentItem?: TorrentMediaInput) => Promise<void>;
}) {
  const [seasonNumber, setSeasonNumber] = useState("");
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [absoluteEpisodeNumber, setAbsoluteEpisodeNumber] = useState("");
  const [validationMessage, setValidationMessage] = useState<string>();
  const episodic = details.type === "series" || details.type === "anime";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const season = readOptionalPositiveInteger(seasonNumber);
    const episode = readOptionalPositiveInteger(episodeNumber);
    const absoluteEpisode = readOptionalPositiveInteger(absoluteEpisodeNumber);

    if (season === false || episode === false || absoluteEpisode === false) {
      setValidationMessage("Episode fields must contain positive whole numbers.");
      return;
    }

    if (episode !== undefined && season === undefined) {
      setValidationMessage("Select a season before an ordinary episode.");
      return;
    }

    if (absoluteEpisode !== undefined && (season !== undefined || episode !== undefined)) {
      setValidationMessage("Use either season/episode or an absolute episode, not both.");
      return;
    }

    setValidationMessage(undefined);
    void onDiscover(item, {
      ...details,
      ...(season !== undefined ? { seasonNumber: season } : {}),
      ...(episode !== undefined ? { episodeNumber: episode } : {}),
      ...(absoluteEpisode !== undefined ? { absoluteEpisodeNumber: absoluteEpisode } : {}),
    });
  }

  return (
    <form className="torrent-discovery" onSubmit={handleSubmit}>
      <span>Torrent discovery</span>
      {episodic ? (
        <div className="torrent-discovery__fields">
          <label className="field">
            <span>Season (optional)</span>
            <input
              max="9999"
              min="1"
              onChange={(event) => setSeasonNumber(event.target.value)}
              type="number"
              value={seasonNumber}
            />
          </label>
          <label className="field">
            <span>Episode (optional)</span>
            <input
              max="9999"
              min="1"
              onChange={(event) => setEpisodeNumber(event.target.value)}
              type="number"
              value={episodeNumber}
            />
          </label>
          {details.type === "anime" ? (
            <label className="field">
              <span>Absolute episode</span>
              <input
                max="9999"
                min="1"
                onChange={(event) => setAbsoluteEpisodeNumber(event.target.value)}
                type="number"
                value={absoluteEpisodeNumber}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <button className="details-button" disabled={loading} type="submit">
        {loading ? "Searching torrents..." : "Find torrent candidates"}
      </button>
      {validationMessage ? (
        <span className="torrent-discovery__error" role="alert">
          {validationMessage}
        </span>
      ) : null}
      <span className="muted">
        Explicit discovery only. The browser does not start a torrent client or download media.
      </span>
    </form>
  );
}

function readOptionalPositiveInteger(value: string): number | undefined | false {
  if (!value.trim()) return undefined;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 9_999 ? parsed : false;
}
