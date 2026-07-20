import { useState } from "react";
import {
  formatPlayerMeta,
  formatProviderFailure,
  getAvailabilityOptions,
  groupAvailabilityOptions,
} from "../utils/format";
import type { AvailabilityOption, AvailabilityState } from "../state";

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

  return (
    <section className="detail-section" aria-live="polite">
      <span>Players</span>
      <span className="muted">
        {state.response.options.length > 0
          ? `${state.response.options.length} options available`
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
                <span>{group.options.length}</span>
              </div>
              <ul className="player-list">
                {group.options.map((option) => (
                  <li className="player-option" key={option.id}>
                    <div className="player-option__main">
                      <strong>{option.player.label}</strong>
                      <span>{formatPlayerMeta(option)}</span>
                    </div>
                    <button
                      className="player-option__action"
                      onClick={() => setSelectedOptionId(option.id)}
                      type="button"
                    >
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {selectedOption ? <PlayerPreview key={selectedOption.id} option={selectedOption} /> : null}
    </section>
  );
}

function PlayerPreview({ option }: { option: AvailabilityOption }) {
  const [embedEnabled, setEmbedEnabled] = useState(false);

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

  if (option.player.kind !== "embed") {
    return (
      <div className="player-preview">
        <strong>{option.player.label}</strong>
        <a href={option.access.url} rel="noopener noreferrer" target="_blank">
          Open stream
        </a>
      </div>
    );
  }

  return (
    <div className="player-preview">
      <strong>{option.player.label}</strong>
      <div className="player-preview__actions">
        <a href={option.access.url} rel="noopener noreferrer" target="_blank">
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
          referrerPolicy="no-referrer"
          sandbox="allow-presentation allow-scripts"
          src={option.access.url}
          title={`${option.player.label} player`}
        />
      ) : (
        <span className="muted">Embedded playback is disabled until you explicitly load it.</span>
      )}
    </div>
  );
}
