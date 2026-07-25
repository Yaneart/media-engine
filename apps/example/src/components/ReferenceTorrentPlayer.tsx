import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import type { TorrentCandidate } from "../api";
import {
  createReferencePlaybackSession,
  getReferencePlaybackSession,
  getReferencePlayerConfig,
  getReferenceStreamUrl,
  stopReferencePlaybackSession,
} from "../api/reference-player";
import type { TorrentPlaybackFile, TorrentPlaybackSession } from "../api/reference-player";

type PlayerState =
  | { status: "checking" }
  | { status: "disabled"; reason: "configuration" | "candidate" }
  | { status: "idle" }
  | { status: "starting" }
  | { status: "active"; session: TorrentPlaybackSession }
  | { status: "error"; message: string };

export function ReferenceTorrentPlayer({ candidate }: { candidate: TorrentCandidate }) {
  const [state, setState] = useState<PlayerState>({ status: "checking" });
  const [mediaStatus, setMediaStatus] = useState("Waiting to start.");
  const [buffered, setBuffered] = useState("No buffered media.");
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const playableCandidate = candidate.handoff.kind === "magnet" && !candidate.handoff.headers;

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    const stopActiveSessionOnExit = () => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      activeSessionIdRef.current = undefined;
      void stopReferencePlaybackSession(sessionId, { keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", stopActiveSessionOnExit);

    void getReferencePlayerConfig(controller.signal)
      .then((config) => {
        if (!controller.signal.aborted) {
          setState(
            config.enabled && playableCandidate
              ? { status: "idle" }
              : {
                  status: "disabled",
                  reason: config.enabled ? "candidate" : "configuration",
                },
          );
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Could not read player configuration.",
          });
        }
      });

    return () => {
      window.removeEventListener("pagehide", stopActiveSessionOnExit);
      controller.abort();
      requestRef.current?.abort();
      stopActiveSessionOnExit();
    };
  }, [candidate.id, candidate.provider, playableCandidate]);

  async function start(fileId?: number) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: "starting" });
    setMediaStatus("Preparing torrent metadata.");

    try {
      const previousSessionId = activeSessionIdRef.current;
      const session = await createReferencePlaybackSession(
        {
          provider: candidate.provider,
          candidateId: candidate.id,
          ...(fileId === undefined ? {} : { fileId }),
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;
      activeSessionIdRef.current = session.id;
      setState({ status: "active", session });
      setMediaStatus(describeSessionState(session));

      if (previousSessionId && previousSessionId !== session.id) {
        await stopReferencePlaybackSession(previousSessionId).catch(() => undefined);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not create playback session.",
      });
    }
  }

  async function refresh() {
    if (state.status !== "active") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const session = await getReferencePlaybackSession(state.session.id, controller.signal);
      if (controller.signal.aborted) return;
      activeSessionIdRef.current = session.state === "stopped" ? undefined : session.id;
      setState({ status: "active", session });
      setMediaStatus(describeSessionState(session));
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not refresh playback session.",
        });
      }
    }
  }

  async function stop() {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    activeSessionIdRef.current = undefined;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const session = await stopReferencePlaybackSession(sessionId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      activeSessionIdRef.current = undefined;
      setState({ status: "active", session });
      setMediaStatus("Session stopped and torrent resources released.");
      setBuffered("No buffered media.");
    } catch (error) {
      if (!controller.signal.aborted) {
        activeSessionIdRef.current = sessionId;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not stop playback session.",
        });
      }
    }
  }

  function updateMediaProgress(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (video.buffered.length === 0) {
      setBuffered("No buffered media.");
      return;
    }

    const ranges = Array.from({ length: video.buffered.length }, (_, index) => {
      const start = video.buffered.start(index).toFixed(1);
      const end = video.buffered.end(index).toFixed(1);
      return `${start}–${end}s`;
    });
    setBuffered(`Buffered: ${ranges.join(", ")}`);
  }

  if (state.status === "checking") {
    return <span className="muted">Checking reference player configuration.</span>;
  }

  if (state.status === "disabled") {
    return (
      <span className="muted">
        {state.reason === "candidate"
          ? "This source does not expose a safe server-catalogued magnet handoff for reference playback."
          : "Reference playback is disabled. Discovery remains available without exposing an operator token."}
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <div className="reference-player__error" role="alert">
        <span>{state.message}</span>
        <button className="details-button" onClick={() => void start()} type="button">
          Try again
        </button>
      </div>
    );
  }

  if (state.status === "idle" || state.status === "starting") {
    return (
      <button
        className="details-button"
        disabled={state.status === "starting"}
        onClick={() => void start()}
        type="button"
      >
        {state.status === "starting" ? "Preparing playback..." : "Start reference playback"}
      </button>
    );
  }

  const { session } = state;
  const directlyPlayable = session.state === "ready" && session.compatibility === "direct";

  return (
    <div className="reference-player">
      <div className="reference-player__status">
        <strong>{formatState(session.state)}</strong>
        <span>{mediaStatus}</span>
        <span>Expires {new Date(session.expiresAt).toLocaleString()}</span>
      </div>

      {session.state === "file_selection_required" && session.files?.length ? (
        <FileSelection files={session.files} onSelect={start} />
      ) : null}

      {session.state === "conversion_required" ? (
        <div className="reference-player__notice" role="status">
          <strong>Browser playback intentionally withheld</strong>
          <span>
            This file is classified as {formatCompatibility(session.compatibility)}. The reference
            path does not yet remux or transcode it.
          </span>
        </div>
      ) : null}

      {directlyPlayable ? (
        <div className="reference-player__media">
          <video
            aria-label={`Reference playback for ${candidate.title}`}
            controls
            onCanPlay={() => setMediaStatus("Enough data is available to begin playback.")}
            onError={() => setMediaStatus("The browser could not decode or load this direct file.")}
            onLoadStart={() => setMediaStatus("Opening the bounded range stream.")}
            onPlaying={() => setMediaStatus("Playing.")}
            onProgress={updateMediaProgress}
            onSeeking={() => setMediaStatus("Seeking through a new byte range.")}
            onStalled={() => setMediaStatus("Playback stalled while waiting for media data.")}
            onWaiting={() => setMediaStatus("Buffering.")}
            preload="metadata"
            src={getReferenceStreamUrl(session)}
          />
          <span className="muted">{buffered}</span>
        </div>
      ) : null}

      {session.selectedFile ? <SelectedFile file={session.selectedFile} /> : null}
      {session.error ? (
        <span className="reference-player__error" role="alert">
          {session.error.message}
        </span>
      ) : null}

      <div className="torrent-candidate__actions">
        {session.state !== "stopped" ? (
          <button className="details-button" onClick={() => void refresh()} type="button">
            Refresh status
          </button>
        ) : null}
        {session.state !== "stopped" ? (
          <button className="details-button" onClick={() => void stop()} type="button">
            Stop and clean up
          </button>
        ) : (
          <button className="details-button" onClick={() => void start()} type="button">
            Start again
          </button>
        )}
      </div>
    </div>
  );
}

function FileSelection({
  files,
  onSelect,
}: {
  files: TorrentPlaybackFile[];
  onSelect: (fileId: number) => Promise<void>;
}) {
  const [fileId, setFileId] = useState(files[0]?.id ?? 0);
  return (
    <div className="reference-player__selection">
      <label className="field">
        <span>File</span>
        <select onChange={(event) => setFileId(Number(event.target.value))} value={fileId}>
          {files.map((file) => (
            <option key={file.id} value={file.id}>
              {file.path} · {formatBytes(file.length)} · {formatCompatibility(file.compatibility)}
            </option>
          ))}
        </select>
      </label>
      <button className="details-button" onClick={() => void onSelect(fileId)} type="button">
        Use selected file
      </button>
    </div>
  );
}

function SelectedFile({ file }: { file: TorrentPlaybackFile }) {
  return (
    <div className="reference-player__file">
      <strong>{file.path}</strong>
      <span>
        {formatBytes(file.length)} · {formatCompatibility(file.compatibility)}
      </span>
    </div>
  );
}

function describeSessionState(session: TorrentPlaybackSession): string {
  if (session.state === "ready")
    return "Direct file selected. Browser support still depends on its codecs.";
  if (session.state === "conversion_required")
    return "The selected file requires conversion before browser playback.";
  if (session.state === "file_selection_required")
    return "Choose one bounded video file from the torrent metadata.";
  if (session.state === "failed") return session.error?.message ?? "Playback preparation failed.";
  if (session.state === "stopped") return "Session stopped and torrent resources released.";
  return "Preparing torrent metadata.";
}

function formatState(value: TorrentPlaybackSession["state"]): string {
  return value.replaceAll("_", " ");
}

function formatCompatibility(value: TorrentPlaybackSession["compatibility"]): string {
  return value?.replaceAll("_", " ") ?? "unknown compatibility";
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
