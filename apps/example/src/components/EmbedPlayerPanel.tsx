import { useState } from "react";
import type { AvailabilityOption, AvailabilityState } from "../state";
import { formatPlayerLabel, getEmbedPlayerOptions, groupEmbedPlayers } from "../utils/format";
import { AvailabilityWarnings } from "./AvailabilityWarnings";

export function EmbedPlayerPanel({ state }: { state: AvailabilityState }) {
  const [selectedKey, setSelectedKey] = useState<string>();

  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return <PlayerMessage title="Ищем Embed плееры" text="Проверяем доступные внешние плееры…" />;
  }
  if (state.status === "error") {
    return <PlayerMessage error title="Embed плееры недоступны" text={state.message} />;
  }

  const players = groupEmbedPlayers(getEmbedPlayerOptions(state));
  const selectedPlayer = players.find((player) => player.key === selectedKey) ?? players[0];

  return (
    <div className="playback-mode__content" aria-live="polite">
      <AvailabilityWarnings response={state.response} />
      {players.length > 0 ? (
        <>
          <div className="embed-player-list" aria-label="Доступные Embed плееры">
            {players.map((player) => (
              <button
                aria-pressed={selectedPlayer?.key === player.key}
                className="embed-player-card"
                key={player.key}
                onClick={() => setSelectedKey(player.key)}
                type="button"
              >
                <strong>{player.label}</strong>
                <span>{player.providerLabel}</span>
              </button>
            ))}
          </div>
          {selectedPlayer ? (
            <EmbedPreview key={selectedPlayer.option.id} option={selectedPlayer.option} />
          ) : null}
        </>
      ) : (
        <PlayerMessage
          title="Embed плееры не найдены"
          text="Для этого фильма или сериала внешних плееров пока нет."
        />
      )}
    </div>
  );
}

function EmbedPreview({ option }: { option: AvailabilityOption }) {
  const [enabled, setEnabled] = useState(false);
  const label = formatPlayerLabel(option.player.label);

  if (option.player.kind === "external") {
    return (
      <div className="player-preview">
        <strong>{label}</strong>
        <div className="player-preview__actions">
          <a href={option.access.url} rel="noopener noreferrer" target="_blank">
            Открыть плеер
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="player-preview">
      <strong>{label}</strong>
      <div className="player-preview__actions">
        <button onClick={() => setEnabled((current) => !current)} type="button">
          {enabled ? "Закрыть плеер" : "Загрузить плеер"}
        </button>
        <a href={option.access.url} referrerPolicy="origin" rel="noopener" target="_blank">
          Открыть в новой вкладке
        </a>
      </div>
      {enabled ? (
        <iframe
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="origin"
          sandbox="allow-presentation allow-same-origin allow-scripts"
          src={option.access.url}
          title={`${label} player`}
        />
      ) : (
        <span className="muted">Плеер загрузится только после нажатия кнопки.</span>
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
