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
  const [pending, setPending] = useState(false);
  const [requestedLabel, setRequestedLabel] = useState<string>();
  const isAnime = details.type === "anime";
  const busy = loading || pending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const episode = Number.parseInt(episodeNumber, 10);
    if (!Number.isInteger(episode) || episode <= 0) return;

    let availabilityItem: AvailabilityMediaInput;
    let label: string;

    if (isAnime) {
      availabilityItem = {
        ...details,
        absoluteEpisodeNumber: episode,
      };
      label = `эпизода ${episode}`;
    } else {
      const season = Number.parseInt(seasonNumber, 10);
      if (!Number.isInteger(season) || season <= 0) return;
      availabilityItem = {
        ...details,
        seasonNumber: season,
        episodeNumber: episode,
      };
      label = `сезона ${season}, серии ${episode}`;
    }

    setRequestedLabel(label);
    setPending(true);
    try {
      await onLoadAvailability(item, availabilityItem);
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={busy} className="episode-picker" onSubmit={handleSubmit}>
      <strong>{isAnime ? "Выбор эпизода" : "Выбор сезона и серии"}</strong>
      <div className="episode-picker__fields">
        {!isAnime ? (
          <label className="field">
            <span>Сезон</span>
            <input
              disabled={busy}
              min="1"
              onChange={(event) => setSeasonNumber(event.target.value)}
              required
              type="number"
              value={seasonNumber}
            />
          </label>
        ) : null}
        <label className="field">
          <span>{isAnime ? "Эпизод" : "Серия"}</span>
          <input
            disabled={busy}
            min="1"
            onChange={(event) => setEpisodeNumber(event.target.value)}
            required
            type="number"
            value={episodeNumber}
          />
        </label>
        <button className="details-button" disabled={busy} type="submit">
          {busy ? "Ищем источники…" : isAnime ? "Показать эпизод" : "Показать серию"}
        </button>
      </div>
      {busy ? (
        <div className="episode-picker__loading" role="status">
          <span aria-hidden="true" className="loading-spinner" />
          <span>
            {requestedLabel
              ? `Загружаем источники для ${requestedLabel}. Это обычно занимает 5–15 секунд.`
              : "Проверяем доступные источники…"}
          </span>
        </div>
      ) : (
        <span className="muted">Основной плеер покажет потоки выбранной серии.</span>
      )}
    </form>
  );
}
