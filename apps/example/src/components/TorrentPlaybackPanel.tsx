import { useEffect, useRef, useState } from "react";
import type { FormEvent, SyntheticEvent } from "react";
import {
  discoverTorrents,
  inferTitleLanguage,
  type MediaDetails,
  type TorrentCandidate,
  type TorrentDiscoveryResponse,
} from "../api";
import {
  createOriginalTorrentSession,
  getOriginalTorrentBffConfig,
  getOriginalTorrentSession,
  resolveOriginalTorrentStreamUrl,
  selectOriginalTorrentFile,
  stopOriginalTorrentSession,
  stopOriginalTorrentSessionBestEffort,
  toOriginalTorrentSessionQuery,
  type OriginalTorrentFailure,
  type OriginalTorrentSessionSnapshot,
} from "../api/originalTorrent";
import {
  buildTorrentDiscoveryQuery,
  formatBytes,
  formatTorrentCandidateMeta,
  formatTorrentPeers,
  mapNativeMediaFailure,
  type TorrentEpisodeSelection,
} from "../torrent-player/model";

type DiscoveryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: TorrentDiscoveryResponse }
  | { status: "empty"; response: TorrentDiscoveryResponse }
  | { status: "error"; message: string };

type PlayerPhase = "idle" | "waiting_first_piece" | "ready" | "playing" | "buffering";

export function TorrentPlaybackPanel({ details }: { details: MediaDetails }) {
  const [enabled, setEnabled] = useState<boolean>();
  const [discovery, setDiscovery] = useState<DiscoveryState>({ status: "idle" });
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string>();
  const [activeCandidate, setActiveCandidate] = useState<TorrentCandidate>();
  const [snapshot, setSnapshot] = useState<OriginalTorrentSessionSnapshot>();
  const [failure, setFailure] = useState<OriginalTorrentFailure>();
  const [controlError, setControlError] = useState<string>();
  const [playerPhase, setPlayerPhase] = useState<PlayerPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [seasonNumber, setSeasonNumber] = useState("1");
  const [episodeNumber, setEpisodeNumber] = useState("1");
  const [absoluteEpisodeNumber, setAbsoluteEpisodeNumber] = useState("1");
  const sessionIdRef = useRef<string | undefined>(undefined);
  const pollControllerRef = useRef<AbortController | undefined>(undefined);
  const operationControllerRef = useRef<AbortController | undefined>(undefined);
  const pollGenerationRef = useRef(0);
  const playedRef = useRef(false);

  const response =
    discovery.status === "success" || discovery.status === "empty" ? discovery.response : undefined;
  const candidates = response?.candidates ?? [];
  const selectedCandidate =
    candidates.find((candidate) => candidateKey(candidate) === selectedCandidateKey) ??
    candidates[0];

  useEffect(() => {
    const controller = new AbortController();
    operationControllerRef.current = controller;

    void getOriginalTorrentBffConfig(controller.signal)
      .then((config) => setEnabled(config.enabled))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setEnabled(false);
          setControlError(readErrorMessage(error, "Could not read torrent player configuration."));
        }
      });

    const handlePageHide = () => {
      const sessionId = sessionIdRef.current;
      if (sessionId !== undefined) {
        sessionIdRef.current = undefined;
        stopOriginalTorrentSessionBestEffort(sessionId);
      }
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      controller.abort();
      operationControllerRef.current?.abort();
      pollControllerRef.current?.abort();
      pollGenerationRef.current += 1;
      window.removeEventListener("pagehide", handlePageHide);
      handlePageHide();
    };
  }, []);

  async function handleDiscover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await stopCurrentSession();
    } catch (error) {
      setControlError(readErrorMessage(error, "Could not stop the current torrent session."));
      return;
    }

    const episode = readEpisodeSelection(
      details.type,
      seasonNumber,
      episodeNumber,
      absoluteEpisodeNumber,
    );

    if (episode === false) {
      setControlError("Enter positive whole episode numbers before discovering releases.");
      return;
    }

    operationControllerRef.current?.abort();
    const controller = new AbortController();
    operationControllerRef.current = controller;
    setDiscovery({ status: "loading" });
    setSelectedCandidateKey(undefined);
    setControlError(undefined);
    setFailure(undefined);

    try {
      const query = buildTorrentDiscoveryQuery(details, inferTitleLanguage(details.title), episode);
      const nextResponse = await discoverTorrents(query, controller.signal);

      if (controller.signal.aborted) return;
      setDiscovery(
        nextResponse.candidates.length > 0
          ? { status: "success", response: nextResponse }
          : { status: "empty", response: nextResponse },
      );
      setSelectedCandidateKey(
        nextResponse.candidates[0] === undefined
          ? undefined
          : candidateKey(nextResponse.candidates[0]),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setDiscovery({
          status: "error",
          message: readErrorMessage(error, "Torrent discovery failed."),
        });
      }
    }
  }

  async function handleCandidateChange(candidate: TorrentCandidate) {
    if (candidateKey(candidate) === selectedCandidateKey) return;

    setBusy(true);
    setControlError(undefined);
    try {
      await stopCurrentSession();
      setSelectedCandidateKey(candidateKey(candidate));
      setFailure(undefined);
    } catch (error) {
      setControlError(readErrorMessage(error, "Could not stop the previous release."));
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (selectedCandidate === undefined || response === undefined) return;

    setBusy(true);
    setControlError(undefined);
    setFailure(undefined);
    setPlayerPhase("idle");
    playedRef.current = false;

    try {
      await stopCurrentSession();
      const controller = new AbortController();
      operationControllerRef.current = controller;
      const created = await createOriginalTorrentSession(
        toOriginalTorrentSessionQuery(response.query),
        selectedCandidate,
        controller.signal,
      );
      sessionIdRef.current = created.id;
      setActiveCandidate(selectedCandidate);
      applySnapshot(created);
      startPolling(created.id);
    } catch (error) {
      setControlError(readErrorMessage(error, "Could not start the torrent session."));
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSelection(fileId: number) {
    const sessionId = sessionIdRef.current;
    if (sessionId === undefined) return;

    setBusy(true);
    setControlError(undefined);
    try {
      const selected = await selectOriginalTorrentFile(sessionId, fileId);
      applySnapshot(selected);
      if (isActiveState(selected.state)) startPolling(sessionId);
    } catch (error) {
      setControlError(readErrorMessage(error, "The selected file could not be opened."));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setControlError(undefined);
    try {
      await stopCurrentSession();
    } catch (error) {
      setControlError(readErrorMessage(error, "Could not stop the torrent session."));
    } finally {
      setBusy(false);
    }
  }

  function applySnapshot(nextSnapshot: OriginalTorrentSessionSnapshot) {
    setSnapshot(nextSnapshot);
    setFailure(nextSnapshot.error);

    if (nextSnapshot.state === "ready") {
      setPlayerPhase("waiting_first_piece");
    } else if (nextSnapshot.state !== "selection_required") {
      setPlayerPhase("idle");
    }
  }

  function startPolling(sessionId: string) {
    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;
    const generation = pollGenerationRef.current + 1;
    pollGenerationRef.current = generation;

    void pollSession(sessionId, generation, controller.signal);
  }

  async function pollSession(sessionId: string, generation: number, signal: AbortSignal) {
    while (!signal.aborted && generation === pollGenerationRef.current) {
      try {
        await abortableDelay(750, signal);
        const nextSnapshot = await getOriginalTorrentSession(sessionId, signal);
        if (signal.aborted || generation !== pollGenerationRef.current) return;
        applySnapshot(nextSnapshot);
        if (!isActiveState(nextSnapshot.state)) return;
      } catch (error) {
        if (signal.aborted || generation !== pollGenerationRef.current) return;
        setControlError(readErrorMessage(error, "Could not refresh the torrent session."));
        await abortableDelay(1_500, signal).catch(() => undefined);
      }
    }
  }

  async function stopCurrentSession() {
    const sessionId = sessionIdRef.current;
    if (sessionId === undefined) return;

    pollControllerRef.current?.abort();
    pollGenerationRef.current += 1;
    await stopOriginalTorrentSession(sessionId);
    sessionIdRef.current = undefined;
    setSnapshot(undefined);
    setActiveCandidate(undefined);
    setFailure(undefined);
    setPlayerPhase("idle");
    playedRef.current = false;
  }

  async function handleVideoError(event: SyntheticEvent<HTMLVideoElement>) {
    const mediaErrorCode = event.currentTarget.error?.code ?? 0;
    const sessionId = sessionIdRef.current;
    let currentSnapshot = snapshot;

    if (sessionId !== undefined) {
      currentSnapshot = await refreshAfterMediaError(sessionId, mediaErrorCode).catch(
        () => currentSnapshot,
      );
      if (currentSnapshot !== undefined) setSnapshot(currentSnapshot);
    }

    setFailure(mapNativeMediaFailure(mediaErrorCode, currentSnapshot));
    setPlayerPhase("idle");
  }

  async function refreshAfterMediaError(sessionId: string, mediaErrorCode: number) {
    let current = await getOriginalTorrentSession(sessionId);

    if (mediaErrorCode === 2 && current.state === "ready") {
      await abortableDelay(300);
      current = await getOriginalTorrentSession(sessionId);
    }

    return current;
  }

  const streamUrl = readStreamUrl(snapshot);

  return (
    <div className="playback-mode__content torrent-player" aria-live="polite">
      <div className="playback-mode__intro">
        <strong>Original torrent file</strong>
        <span>
          Select an observed release and stream its unchanged bytes. Browser format support is not
          guaranteed.
        </span>
      </div>

      {enabled === undefined ? (
        <TorrentNotice title="Checking torrent player" text="Reading server configuration." />
      ) : null}
      {enabled === false ? (
        <TorrentNotice
          error
          title="Torrent player unavailable"
          text={controlError ?? "Configure the server token and start the TorrServer profile."}
        />
      ) : null}

      {enabled ? (
        <>
          <form className="torrent-discovery-form" onSubmit={handleDiscover}>
            {details.type === "series" ? (
              <div className="episode-picker__fields">
                <NumberField label="Season" onChange={setSeasonNumber} value={seasonNumber} />
                <NumberField label="Episode" onChange={setEpisodeNumber} value={episodeNumber} />
              </div>
            ) : null}
            {details.type === "anime" ? (
              <NumberField
                label="Absolute episode"
                onChange={setAbsoluteEpisodeNumber}
                value={absoluteEpisodeNumber}
              />
            ) : null}
            <button
              className="playback-primary-action"
              disabled={busy || discovery.status === "loading"}
              type="submit"
            >
              {discovery.status === "loading" ? "Finding releases…" : "Find torrent releases"}
            </button>
          </form>

          {discovery.status === "error" ? (
            <TorrentNotice error title="Torrent discovery failed" text={discovery.message} />
          ) : null}
          {discovery.status === "empty" ? (
            <TorrentNotice
              title="No torrent releases found"
              text="Try another title, episode, or configured provider."
            />
          ) : null}
          {discovery.status === "success" ? (
            <div className="torrent-release-list" aria-label="Torrent releases">
              {candidates.map((candidate) => {
                const key = candidateKey(candidate);
                const selected = key === candidateKey(selectedCandidate!);
                return (
                  <button
                    aria-pressed={selected}
                    className="torrent-release"
                    disabled={busy}
                    key={key}
                    onClick={() => void handleCandidateChange(candidate)}
                    type="button"
                  >
                    <strong>{candidate.title}</strong>
                    <span>{formatTorrentCandidateMeta(candidate)}</span>
                    <span>{formatTorrentPeers(candidate)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {selectedCandidate !== undefined ? (
            <div className="torrent-selection-summary">
              <div>
                <span>Selected release</span>
                <strong>{selectedCandidate.title}</strong>
                <small>
                  {selectedCandidate.provider} · observation {selectedCandidate.id}
                </small>
              </div>
              <button
                className="playback-primary-action"
                disabled={busy || sessionIdRef.current !== undefined}
                onClick={() => void handleStart()}
                type="button"
              >
                Start original stream
              </button>
            </div>
          ) : null}

          {activeCandidate !== undefined && snapshot !== undefined ? (
            <SessionStatus candidate={activeCandidate} snapshot={snapshot} />
          ) : null}

          {snapshot?.state === "selection_required" && snapshot.files !== undefined ? (
            <FileSelection
              busy={busy}
              files={snapshot.files}
              onSelect={(fileId) => void handleFileSelection(fileId)}
            />
          ) : null}

          {streamUrl !== undefined && snapshot?.selectedFile !== undefined ? (
            <div className="original-video-player">
              <div className="original-video-player__heading">
                <div>
                  <span>Selected file #{snapshot.selectedFile.id}</span>
                  <strong>{snapshot.selectedFile.path}</strong>
                  <small>{formatBytes(snapshot.selectedFile.length)}</small>
                </div>
                <PlaybackPhase phase={playerPhase} />
              </div>
              <video
                controls
                key={streamUrl}
                onCanPlay={() => setPlayerPhase(playedRef.current ? "playing" : "ready")}
                onError={(event) => void handleVideoError(event)}
                onLoadedData={() => setPlayerPhase(playedRef.current ? "playing" : "ready")}
                onLoadStart={() => setPlayerPhase("waiting_first_piece")}
                onPlaying={() => {
                  playedRef.current = true;
                  setPlayerPhase("playing");
                }}
                onStalled={() =>
                  setPlayerPhase(playedRef.current ? "buffering" : "waiting_first_piece")
                }
                onWaiting={() =>
                  setPlayerPhase(playedRef.current ? "buffering" : "waiting_first_piece")
                }
                playsInline
                preload="metadata"
                src={streamUrl}
                title={`${snapshot.selectedFile.path} original torrent player`}
              />
            </div>
          ) : null}

          {failure !== undefined ? (
            <TorrentNotice error title={failure.code} text={failure.message} />
          ) : null}
          {controlError !== undefined && failure === undefined ? (
            <TorrentNotice error title="Torrent session request failed" text={controlError} />
          ) : null}

          {sessionIdRef.current !== undefined ? (
            <button
              className="playback-stop-action"
              disabled={busy}
              onClick={() => void handleStop()}
              type="button"
            >
              {busy ? "Stopping…" : "Stop and release torrent"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        min="1"
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

function TorrentNotice({
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

function SessionStatus({
  candidate,
  snapshot,
}: {
  candidate: TorrentCandidate;
  snapshot: OriginalTorrentSessionSnapshot;
}) {
  const description =
    snapshot.state === "adding"
      ? "Registering the exact selected provider observation with TorrServer."
      : snapshot.state === "waiting_metadata"
        ? "Waiting for torrent metadata from reachable peers."
        : snapshot.state === "selection_required"
          ? "Metadata is ready. Select one of the files reported by TorrServer."
          : snapshot.state === "ready"
            ? "The protected original-file capability is ready."
            : (snapshot.error?.message ?? `Session ${snapshot.state}.`);

  return (
    <div className="torrent-session-status">
      <span className={`playback-status playback-status--${snapshot.state}`}>
        {snapshot.state.replaceAll("_", " ")}
      </span>
      <strong>{candidate.title}</strong>
      <span>{description}</span>
      <small>
        {snapshot.observation.provider} · {snapshot.observation.id}
      </small>
    </div>
  );
}

function FileSelection({
  busy,
  files,
  onSelect,
}: {
  busy: boolean;
  files: NonNullable<OriginalTorrentSessionSnapshot["files"]>;
  onSelect: (fileId: number) => void;
}) {
  return (
    <div className="torrent-file-list">
      <div>
        <strong>Select an original file</strong>
        <span>Every regular non-padding file is offered, regardless of extension.</span>
      </div>
      {files.map((file) => (
        <button disabled={busy} key={file.id} onClick={() => onSelect(file.id)} type="button">
          <strong>
            #{file.id} · {file.path}
          </strong>
          <span>{formatBytes(file.length)}</span>
        </button>
      ))}
    </div>
  );
}

function PlaybackPhase({ phase }: { phase: PlayerPhase }) {
  if (phase === "idle") return null;

  const text =
    phase === "waiting_first_piece"
      ? "Buffering first pieces"
      : phase === "buffering"
        ? "Buffering stream"
        : phase === "ready"
          ? "Ready to play"
          : "Playing original file";

  return (
    <span className={`original-video-player__phase original-video-player__phase--${phase}`}>
      {text}
    </span>
  );
}

function candidateKey(candidate: Pick<TorrentCandidate, "provider" | "id">): string {
  return `${candidate.provider}\u0000${candidate.id}`;
}

function readEpisodeSelection(
  type: MediaDetails["type"],
  season: string,
  episode: string,
  absoluteEpisode: string,
): TorrentEpisodeSelection | false {
  if (type === "series") {
    const seasonNumber = readPositiveInteger(season);
    const episodeNumber = readPositiveInteger(episode);
    return seasonNumber === undefined || episodeNumber === undefined
      ? false
      : { seasonNumber, episodeNumber };
  }

  if (type === "anime") {
    const absoluteEpisodeNumber = readPositiveInteger(absoluteEpisode);
    return absoluteEpisodeNumber === undefined ? false : { absoluteEpisodeNumber };
  }

  return {};
}

function readPositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isActiveState(state: OriginalTorrentSessionSnapshot["state"]): boolean {
  return state === "adding" || state === "waiting_metadata";
}

function readStreamUrl(snapshot: OriginalTorrentSessionSnapshot | undefined): string | undefined {
  if (snapshot?.state !== "ready" || snapshot.streamUrl === undefined) return undefined;

  try {
    return resolveOriginalTorrentStreamUrl(snapshot.streamUrl);
  } catch {
    return undefined;
  }
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
