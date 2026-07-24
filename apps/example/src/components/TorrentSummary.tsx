import { useState } from "react";
import type { TorrentCandidate } from "../api";
import type { TorrentState } from "../state";

interface TorrentCandidateGroup {
  key: string;
  representative: TorrentCandidate;
  observations: TorrentCandidate[];
}

export function TorrentSummary({ state }: { state: TorrentState }) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "loading") {
    return <span className="muted">Loading torrent candidates.</span>;
  }

  if (state.status === "error") {
    return (
      <span className="torrent-discovery__error" role="alert">
        {state.message}
      </span>
    );
  }

  const failedProviders = state.response.meta?.providers.failed ?? [];
  const groups = groupTorrentCandidates(state.response.candidates);

  if (groups.length === 0) {
    return (
      <div className="torrent-results" aria-live="polite">
        <span className="muted">No torrent candidates returned by configured providers.</span>
        <ProviderFailures failures={failedProviders} />
      </div>
    );
  }

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? groups[0]!;
  const selectedCandidate =
    selectedGroup.observations.find((candidate) => candidate.id === selectedCandidateId) ??
    selectedGroup.representative;

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
      <span className="muted">
        {state.response.candidates.length} source observations · {groups.length} unique info hashes
        {failedProviders.length > 0 ? ` · ${failedProviders.length} provider failures` : ""}
      </span>
      <ProviderFailures failures={failedProviders} />

      <label className="field">
        <span>Release</span>
        <select
          onChange={(event) => {
            const group = groups.find(
              (candidateGroup) => candidateGroup.key === event.target.value,
            );
            if (!group) return;
            setSelectedGroupKey(group.key);
            setSelectedCandidateId(group.representative.id);
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
          <span>Source observation</span>
          <select
            onChange={(event) => {
              setSelectedCandidateId(event.target.value);
              setCopyStatus(undefined);
            }}
            value={selectedCandidate.id}
          >
            {selectedGroup.observations.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {formatSourceObservation(candidate)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="torrent-candidate">
        <strong>{selectedCandidate.title}</strong>
        <span>{formatCandidateMeta(selectedCandidate)}</span>
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

function availabilityRank(value: TorrentCandidate["availability"]): number {
  if (value === "available") return 2;
  if (value === "unknown") return 1;
  return 0;
}

function formatGroupLabel(group: TorrentCandidateGroup): string {
  const candidate = group.representative;
  const resolution = candidate.release?.resolution ?? "Unknown quality";
  const sources = group.observations.length;
  return `${resolution} · ${candidate.title} · ${sources} source${sources === 1 ? "" : "s"}`;
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
    <ul className="provider-failures">
      {failures.map((failure) => (
        <li key={`${failure.provider}:${failure.code}`}>
          {failure.provider}: {failure.message}
        </li>
      ))}
    </ul>
  ) : null;
}
