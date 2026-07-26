import { getApiBaseUrl } from "./index";

const REFERENCE_PLAYER_PATH = "/reference-player";

export type TorrentPlaybackSessionState =
  "starting" | "file_selection_required" | "ready" | "conversion_required" | "failed" | "stopped";

export type TorrentPlaybackCompatibility =
  "direct" | "remux_required" | "transcode_required" | "unknown";
export type TorrentPlaybackMode = "direct" | "remux";

export interface TorrentPlaybackFile {
  id: number;
  path: string;
  length: number;
  compatibility: TorrentPlaybackCompatibility;
}

export interface TorrentPlaybackSession {
  id: string;
  streamUrl: string;
  state: TorrentPlaybackSessionState;
  provider: string;
  candidateId: string;
  infoHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  compatibility?: TorrentPlaybackCompatibility;
  playbackMode?: TorrentPlaybackMode;
  selectedFile?: TorrentPlaybackFile;
  files?: TorrentPlaybackFile[];
  error?: { code: string; message: string };
}

export async function getReferencePlayerConfig(
  signal?: AbortSignal,
): Promise<{ enabled: boolean }> {
  return requestReferencePlayer(`${REFERENCE_PLAYER_PATH}/config`, { signal });
}

export async function createReferencePlaybackSession(
  input: { provider: string; candidateId: string; fileId?: number },
  signal?: AbortSignal,
): Promise<TorrentPlaybackSession> {
  return requestReferencePlayer(`${REFERENCE_PLAYER_PATH}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export async function getReferencePlaybackSession(
  id: string,
  signal?: AbortSignal,
): Promise<TorrentPlaybackSession> {
  return requestReferencePlayer(`${REFERENCE_PLAYER_PATH}/sessions/${encodeURIComponent(id)}`, {
    signal,
  });
}

export async function stopReferencePlaybackSession(
  id: string,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<TorrentPlaybackSession> {
  return requestReferencePlayer(`${REFERENCE_PLAYER_PATH}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: options.keepalive,
    signal: options.signal,
  });
}

export function getReferenceStreamUrl(session: TorrentPlaybackSession): string {
  return new URL(session.streamUrl, `${getApiBaseUrl()}/`).href;
}

async function requestReferencePlayer<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...init.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload) ?? `Reference playback request failed (${response.status}).`,
    );
  }

  return payload as T;
}

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("message" in value)) return undefined;
  const message = value.message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const messages = message.filter((item): item is string => typeof item === "string");
    return messages.length > 0 ? messages.join(" ") : undefined;
  }
  return undefined;
}
