import { useState } from "react";
import type { MediaDetails } from "../api";
import type { AvailabilityOption, AvailabilityState } from "../state";
import {
  formatPlayerMeta,
  formatQualityLabel,
  getPrimaryPlayerOptions,
  groupPrimaryPlayerOptions,
  hasExactEpisodeQuery,
} from "../utils/format";
import { AvailabilityWarnings } from "./AvailabilityWarnings";
import { HlsPlayer } from "./HlsPlayer";

export function PrimaryPlayerPanel({
  details,
  state,
}: {
  details: MediaDetails;
  state: AvailabilityState;
}) {
  const [selectedOptionId, setSelectedOptionId] = useState<string>();

  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return <PlayerMessage title="Ищем прямые потоки" text="Проверяем доступные источники…" />;
  }
  if (state.status === "error") {
    return <PlayerMessage error title="Основной плеер недоступен" text={state.message} />;
  }

  const needsEpisode =
    (details.type === "series" || details.type === "anime") &&
    !hasExactEpisodeQuery(state.response.query, details.type);

  if (needsEpisode) {
    return (
      <div className="playback-mode__content">
        <AvailabilityWarnings response={state.response} />
        <PlayerMessage
          title="Выберите серию"
          text="Укажите сезон и серию выше, чтобы не смешивать потоки разных эпизодов."
        />
      </div>
    );
  }

  const sources = groupPrimaryPlayerOptions(getPrimaryPlayerOptions(state));
  const allOptions = sources.flatMap((source) => source.voices.flatMap((voice) => voice.options));
  const selectedOption =
    allOptions.find((option) => option.id === selectedOptionId) ?? allOptions[0];
  const selectedSource =
    sources.find((source) =>
      source.voices.some((voice) =>
        voice.options.some((option) => option.id === selectedOption?.id),
      ),
    ) ?? sources[0];
  const selectedVoice =
    selectedSource?.voices.find((voice) =>
      voice.options.some((option) => option.id === selectedOption?.id),
    ) ?? selectedSource?.voices[0];

  return (
    <div className="playback-mode__content" aria-live="polite">
      <AvailabilityWarnings response={state.response} />
      {selectedSource && selectedVoice && selectedOption ? (
        <>
          <div className="primary-player-controls">
            <label className="field">
              <span>Источник</span>
              <select
                onChange={(event) => setSelectedOptionId(event.currentTarget.value)}
                value={selectedSource.voices[0]!.options[0]!.id}
              >
                {sources.map((source) => (
                  <option key={source.key} value={source.voices[0]!.options[0]!.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Озвучка</span>
              <select
                onChange={(event) => setSelectedOptionId(event.currentTarget.value)}
                value={selectedVoice.options[0]!.id}
              >
                {selectedSource.voices.map((voice) => (
                  <option key={voice.key} value={voice.options[0]!.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="quality-picker">
              <span>Качество</span>
              <div className="quality-picker__options">
                {selectedVoice.options.map((option) => (
                  <button
                    aria-pressed={selectedOption.id === option.id}
                    className="player-option__action"
                    key={option.id}
                    onClick={() => setSelectedOptionId(option.id)}
                    type="button"
                  >
                    {formatQualityLabel(option)}
                  </button>
                ))}
              </div>
            </div>
            <div className="primary-player__selection">
              <strong>
                {selectedSource.label} · {selectedVoice.label}
              </strong>
              <span>{formatPlayerMeta(selectedOption)}</span>
              {selectedSource.voices.length === 1 ? (
                <span className="primary-player__hint">
                  Этот источник вернул одну встроенную дорожку. Другие озвучки могут быть у другого
                  источника.
                </span>
              ) : null}
            </div>
          </div>
          <DirectPlayer key={selectedOption.id} option={selectedOption} />
        </>
      ) : (
        <PlayerMessage
          title="Прямой поток не найден"
          text="Попробуйте Embed плеер или Torrent плеер."
        />
      )}
    </div>
  );
}

function DirectPlayer({ option }: { option: AvailabilityOption }) {
  const title = `${option.translation?.title ?? option.player.label} — ${formatQualityLabel(option)}`;

  return (
    <div className="player-preview">
      {option.player.kind === "hls" ? (
        <HlsPlayer title={title} url={option.access.url} />
      ) : (
        <video controls playsInline preload="metadata" src={option.access.url} title={title} />
      )}
    </div>
  );
}

function PlayerMessage({
  error = false,
  text,
  title,
}: {
  error?: boolean;
  text: string;
  title: string;
}) {
  return (
    <div className={`playback-empty-state${error ? " playback-empty-state--error" : ""}`}>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
