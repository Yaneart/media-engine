import { useState } from "react";
import {
  type AvailabilityOptionGroup,
  formatPlayerLabel,
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
        <PlayerPicker
          groups={optionGroups}
          onSelect={setSelectedOptionId}
          selectedOption={selectedOption!}
        />
      ) : null}
      {selectedOption ? <PlayerPreview key={selectedOption.id} option={selectedOption} /> : null}
    </section>
  );
}

function PlayerPicker({
  groups,
  onSelect,
  selectedOption,
}: {
  groups: AvailabilityOptionGroup[];
  onSelect: (optionId: string) => void;
  selectedOption: AvailabilityOption;
}) {
  const selectedGroup =
    groups.find((group) => containsOption(group, selectedOption.id)) ?? groups[0]!;
  const selectedPlayer =
    selectedGroup.players.find((player) => containsOption(player, selectedOption.id)) ??
    selectedGroup.players[0]!;
  const selectedVariant =
    selectedPlayer.variants.find((variant) => containsOption(variant, selectedOption.id)) ??
    selectedPlayer.variants[0]!;

  return (
    <div className="player-picker">
      {groups.length > 1 ? (
        <label className="field">
          <span>Playback scope</span>
          <select
            onChange={(event) =>
              onSelect(firstOption(findGroup(groups, event.currentTarget.value)).id)
            }
            value={selectedGroup.key}
          >
            {groups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label} ({countOptions(group)})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>Player</span>
        <select
          onChange={(event) =>
            onSelect(firstOption(findPlayer(selectedGroup, event.currentTarget.value)).id)
          }
          value={selectedPlayer.key}
        >
          {selectedGroup.players.map((player) => (
            <option key={player.key} value={player.key}>
              {player.label} ({player.variants.length})
            </option>
          ))}
        </select>
      </label>
      {selectedPlayer.variants.length > 1 ? (
        <label className="field">
          <span>Voiceover / source</span>
          <select
            onChange={(event) => onSelect(event.currentTarget.value)}
            value={selectedVariant.options[0]!.id}
          >
            {selectedPlayer.variants.map((variant) => (
              <option key={variant.key} value={variant.options[0]!.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="player-picker__selection">
        <strong>{selectedVariant.label}</strong>
        <span>{formatPlayerMeta(selectedOption)}</span>
      </div>
      {selectedVariant.options.length > 1 ? (
        <div className="player-picker__qualities" aria-label="Stream quality">
          {selectedVariant.options.map((option) => (
            <button
              aria-pressed={selectedOption.id === option.id}
              className="player-option__action"
              key={option.id}
              onClick={() => onSelect(option.id)}
              type="button"
            >
              {formatQualityLabel(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type PlayerGroup = AvailabilityOptionGroup["players"][number];
type PlayerVariant = PlayerGroup["variants"][number];

function containsOption(
  value: AvailabilityOptionGroup | PlayerGroup | PlayerVariant,
  optionId: string,
): boolean {
  if ("options" in value) return value.options.some((option) => option.id === optionId);
  if ("variants" in value)
    return value.variants.some((variant) => containsOption(variant, optionId));
  return value.players.some((player) => containsOption(player, optionId));
}

function firstOption(value: AvailabilityOptionGroup | PlayerGroup): AvailabilityOption {
  return "players" in value
    ? value.players[0]!.variants[0]!.options[0]!
    : value.variants[0]!.options[0]!;
}

function findGroup(groups: AvailabilityOptionGroup[], key: string): AvailabilityOptionGroup {
  return groups.find((group) => group.key === key) ?? groups[0]!;
}

function findPlayer(group: AvailabilityOptionGroup, key: string): PlayerGroup {
  return group.players.find((player) => player.key === key) ?? group.players[0]!;
}

function countOptions(group: AvailabilityOptionGroup): number {
  return group.players.reduce(
    (count, player) =>
      count +
      player.variants.reduce((variantCount, variant) => variantCount + variant.options.length, 0),
    0,
  );
}

function PlayerPreview({ option }: { option: AvailabilityOption }) {
  const [embedEnabled, setEmbedEnabled] = useState(false);
  const playerLabel = formatPlayerLabel(option.player.label);
  const title = `${playerLabel}${option.translation?.title ? ` — ${option.translation.title}` : ""}`;

  if (option.player.kind === "external") {
    return (
      <div className="player-preview">
        <strong>{playerLabel}</strong>
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
