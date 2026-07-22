import { useState } from "react";
import {
  type AvailabilityOptionGroup,
  formatPlayerMeta,
  formatProviderFailure,
  formatQualityLabel,
  getAvailabilityOptions,
  groupAvailabilityOptions,
} from "../utils/format";
import type { AvailabilityOption, AvailabilityState } from "../state";
import { HlsPlayer } from "./HlsPlayer";

export function AvailabilitySummary({ state }: { state: AvailabilityState }) {
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
  const verifiedCount = options.filter((option) => option.availability === "available").length;
  const unverifiedCount = options.filter((option) => option.availability === "unknown").length;

  return (
    <section className="detail-section" aria-live="polite">
      <span>Players</span>
      <span className="muted">
        {state.response.options.length > 0
          ? `${state.response.options.length} options returned · ${verifiedCount} verified${unverifiedCount > 0 ? ` · ${unverifiedCount} unverified` : ""}`
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
                <span>
                  {group.players.reduce(
                    (count, playerGroup) => count + playerGroup.variants.length,
                    0,
                  )}
                </span>
              </div>
              {group.players.map((playerGroup) => (
                <PlayerFamily
                  key={playerGroup.label}
                  onSelect={setSelectedOptionId}
                  playerGroup={playerGroup}
                  selectedOptionId={selectedOption?.id}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}
      {selectedOption ? <PlayerPreview key={selectedOption.id} option={selectedOption} /> : null}
    </section>
  );
}

type PlayerGroup = AvailabilityOptionGroup["players"][number];

function PlayerFamily({
  onSelect,
  playerGroup,
  selectedOptionId,
}: {
  onSelect: (optionId: string) => void;
  playerGroup: PlayerGroup;
  selectedOptionId?: string;
}) {
  const [open, setOpen] = useState(playerGroup.variants.length <= 4);

  return (
    <details
      className="player-family"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        <strong>{playerGroup.label}</strong>
        <span>{playerGroup.variants.length} variants</span>
      </summary>
      <ul className="player-list">
        {playerGroup.variants.map((variant) => (
          <li className="player-option" key={`${playerGroup.label}:${variant.options[0]?.id}`}>
            <div className="player-option__main">
              <strong>{variant.label}</strong>
              <span>{formatPlayerMeta(variant.options[0]!)}</span>
            </div>
            <div className="player-option__qualities">
              {variant.options.map((option) => (
                <button
                  aria-pressed={selectedOptionId === option.id}
                  className="player-option__action"
                  key={option.id}
                  onClick={() => onSelect(option.id)}
                  type="button"
                >
                  {formatQualityLabel(option)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PlayerPreview({ option }: { option: AvailabilityOption }) {
  const [embedEnabled, setEmbedEnabled] = useState(false);
  const title = `${option.player.label}${option.translation?.title ? ` — ${option.translation.title}` : ""}`;

  if (option.player.kind === "external") {
    return (
      <div className="player-preview">
        <strong>{option.player.label}</strong>
        <a href={option.access.url} rel="noopener noreferrer" target="_blank">
          Open external player
        </a>
      </div>
    );
  }

  if (option.player.kind === "hls") {
    return (
      <div className="player-preview">
        <strong>{title}</strong>
        <HlsPlayer title={`${title} player`} url={option.access.url} />
      </div>
    );
  }

  if (option.player.kind === "mp4") {
    return (
      <div className="player-preview">
        <strong>{title}</strong>
        <video
          controls
          playsInline
          preload="metadata"
          src={option.access.url}
          title={`${title} player`}
        />
      </div>
    );
  }

  return (
    <div className="player-preview">
      <strong>{title}</strong>
      <div className="player-preview__actions">
        <a href={option.access.url} referrerPolicy="origin" rel="noopener" target="_blank">
          Open external player
        </a>
        <button onClick={() => setEmbedEnabled((enabled) => !enabled)} type="button">
          {embedEnabled ? "Close embedded player" : "Load embedded player"}
        </button>
      </div>
      {embedEnabled ? (
        <iframe
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="origin"
          sandbox="allow-presentation allow-same-origin allow-scripts"
          src={option.access.url}
          title={`${option.player.label} player`}
        />
      ) : (
        <span className="muted">Embedded playback is disabled until you explicitly load it.</span>
      )}
    </div>
  );
}
