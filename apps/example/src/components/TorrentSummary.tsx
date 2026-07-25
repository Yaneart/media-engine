import { useState } from "react";
import type { TorrentCandidate } from "../api";
import type { TorrentState } from "../state";
import { ReferenceTorrentPlayer } from "./ReferenceTorrentPlayer";

interface TorrentCandidateGroup {
  key: string;
  representative: TorrentCandidate;
  observations: TorrentCandidate[];
}

export function TorrentSummary({ state }: { state: TorrentState }) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>();
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <div className="playback-empty-state" aria-live="polite">
        <strong>Searching torrent sources</strong>
        <span>Collecting releases and availability observations.</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="playback-empty-state playback-empty-state--error" role="alert">
        <strong>Torrent search failed</strong>
        <span>{state.message}</span>
      </div>
    );
  }

  const failedProviders = state.response.meta?.providers.failed ?? [];
  const groups = groupTorrentCandidates(state.response.candidates);

  if (groups.length === 0) {
    return (
      <div className="torrent-results" aria-live="polite">
        <div className="playback-empty-state">
          <strong>No torrent releases found</strong>
          <span>Configured providers returned no matching candidates.</span>
        </div>
        <ProviderFailures failures={failedProviders} />
      </div>
    );
  }

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? groups[0]!;
  const selectedCandidate =
    selectedGroup.observations.find(
      (candidate) => getTorrentCandidateKey(candidate) === selectedCandidateKey,
    ) ?? selectedGroup.representative;

  async function copyHandoff() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(selectedCandidate.handoff.uri);
      setCopyStatus("Magnet copied.");
    } catch {
      setCopyStatus("Copy unavailable. Select the handoff field and copy it manually.");
    }
  }

  return (
    <div className="torrent-results" aria-live="polite">
      <div className="playback-stats" aria-label="Torrent search results">
        <span>
          <strong>{groups.length}</strong> releases
        </span>
        <span>
          <strong>{state.response.candidates.length}</strong> observations
        </span>
      </div>
      <ProviderFailures failures={failedProviders} />

      <div className="torrent-release-picker">
        <label className="field">
          <span>Release</span>
          <select
            onChange={(event) => {
              const group = groups.find(
                (candidateGroup) => candidateGroup.key === event.target.value,
              );
              if (!group) return;
              setSelectedGroupKey(group.key);
              setSelectedCandidateKey(getTorrentCandidateKey(group.representative));
              setCopyStatus(undefined);
            }}
            value={selectedGroup.key}
          >
            {groups.map((group) => (
              <option key={group.key} value={group.key}>
                {formatGroupLabel(group)}
              </option>
            ))}
          </select>
        </label>

        {selectedGroup.observations.length > 1 ? (
          <label className="field">
            <span>Availability source</span>
            <select
              onChange={(event) => {
                setSelectedCandidateKey(event.target.value);
                setCopyStatus(undefined);
              }}
              value={getTorrentCandidateKey(selectedCandidate)}
            >
              {selectedGroup.observations.map((candidate) => (
                <option
                  key={getTorrentCandidateKey(candidate)}
                  value={getTorrentCandidateKey(candidate)}
                >
                  {formatSourceObservation(candidate)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="torrent-candidate">
        <div className="torrent-candidate__summary">
          <strong>{selectedCandidate.title}</strong>
          <span>{formatCandidateMeta(selectedCandidate)}</span>
        </div>

        <section className="reference-player-shell" aria-label="Reference torrent player">
          <div className="reference-player-shell__heading">
            <strong>Selected release</strong>
            <span>The player manages this torrent in a private, expiring session.</span>
          </div>
          <ReferenceTorrentPlayer
            key={`${selectedCandidate.provider}:${selectedCandidate.id}`}
            candidate={selectedCandidate}
          />
        </section>

        <details className="torrent-technical">
          <summary>Magnet and source details</summary>
          <div className="torrent-technical__content">
            {selectedCandidate.infoHash ? (
              <code title={selectedCandidate.infoHash}>{selectedCandidate.infoHash}</code>
            ) : null}
            <label className="field">
              <span>Handoff URI</span>
              <input
                aria-label="Torrent handoff URI"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                value={selectedCandidate.handoff.uri}
              />
            </label>
            <div className="torrent-candidate__actions">
              <button className="details-button" onClick={() => void copyHandoff()} type="button">
                Copy magnet
              </button>
              {selectedCandidate.sourceUrl ? (
                <a href={selectedCandidate.sourceUrl} rel="noopener noreferrer" target="_blank">
                  Open source page
                </a>
              ) : null}
            </div>
            {copyStatus ? (
              <span className="muted" role="status">
                {copyStatus}
              </span>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

function groupTorrentCandidates(candidates: TorrentCandidate[]): TorrentCandidateGroup[] {
  const groups = new Map<string, TorrentCandidate[]>();

  for (const candidate of candidates) {
    const key = candidate.infoHash?.toUpperCase() ?? `${candidate.provider}:${candidate.id}`;
    const observations = groups.get(key) ?? [];
    observations.push(candidate);
    groups.set(key, observations);
  }

  return [...groups].map(([key, observations]) => ({
    key,
    representative: observations.toSorted(compareTorrentCandidates)[0]!,
    observations,
  }));
}

function compareTorrentCandidates(left: TorrentCandidate, right: TorrentCandidate): number {
  return (
    availabilityRank(right.availability) - availabilityRank(left.availability) ||
    (right.peers?.seeders ?? -1) - (left.peers?.seeders ?? -1)
  );
}

function getTorrentCandidateKey(candidate: TorrentCandidate): string {
  return `${candidate.provider}:${candidate.id}`;
}

function availabilityRank(value: TorrentCandidate["availability"]): number {
  if (value === "available") return 2;
  if (value === "unknown") return 1;
  return 0;
}

function formatGroupLabel(group: TorrentCandidateGroup): string {
  const candidate = group.representative;
  const resolution = candidate.release?.resolution ?? "Unknown quality";
  const codec = candidate.release?.videoCodec;
  const size = formatBytes(candidate.sizeBytes);
  const seeders = candidate.peers?.seeders;
  const summary = [resolution, codec, size, seeders === undefined ? undefined : `${seeders} seeds`]
    .filter(Boolean)
    .join(" · ");
  return `${summary} — ${candidate.title}`;
}

function formatSourceObservation(candidate: TorrentCandidate): string {
  return `${candidate.provider} · ${formatAvailability(candidate)} · ${formatPeers(candidate)}`;
}

function formatCandidateMeta(candidate: TorrentCandidate): string {
  return [
    candidate.provider,
    candidate.release?.resolution,
    candidate.release?.source && candidate.release.source !== "unknown"
      ? candidate.release.source
      : undefined,
    candidate.release?.videoCodec,
    candidate.release?.hdr?.join(" + "),
    formatBytes(candidate.sizeBytes),
    formatAvailability(candidate),
    formatPeers(candidate),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatAvailability(candidate: TorrentCandidate): string {
  return candidate.availability.replaceAll("_", " ");
}

function formatPeers(candidate: TorrentCandidate): string {
  const seeders = candidate.peers?.seeders;
  const leechers = candidate.peers?.leechers;

  if (seeders === undefined && leechers === undefined) return "peers unknown";
  return `${seeders ?? "?"} seeders / ${leechers ?? "?"} leechers`;
}

function formatBytes(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;

  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }

  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ProviderFailures({
  failures,
}: {
  failures: Array<{ provider: string; code: string; message: string }>;
}) {
  return failures.length > 0 ? (
    <details className="provider-warnings">
      <summary>
        {failures.length} provider {failures.length === 1 ? "warning" : "warnings"}
      </summary>
      <ul className="provider-failures">
        {failures.map((failure) => (
          <li key={`${failure.provider}:${failure.code}`}>
            {failure.provider}: {failure.message}
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}
