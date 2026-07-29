import type { TorrentCandidate, TorrentDiscoveryQuery } from "./index.ts";
import { getApiBaseUrl } from "./index.ts";

const BFF_BASE = "/torrent-player";
const SESSION_ID = /^[A-Za-z0-9_-]{32}$/u;
const STREAM_PATH = /^\/media\/torrent-streams\/[A-Za-z0-9_-]{43}$/u;

export type OriginalTorrentSessionState =
  "adding" | "waiting_metadata" | "selection_required" | "ready" | "failed" | "stopped" | "expired";

export type OriginalTorrentErrorCode =
  | "torrserver_unavailable"
  | "torrent_source_invalid"
  | "torrent_metadata_timeout"
  | "torrent_pieces_unavailable"
  | "torrent_file_not_found"
  | "torrent_file_selection_required"
  | "torrent_stream_failed"
  | "session_stopped"
  | "session_expired"
  | "client_format_unsupported";

export interface OriginalTorrentFile {
  id: number;
  path: string;
  length: number;
}

export interface OriginalTorrentFailure {
  code: OriginalTorrentErrorCode;
  message: string;
  transient: boolean;
}

export interface OriginalTorrentSessionSnapshot {
  id: string;
  state: OriginalTorrentSessionState;
  observation: { provider: string; id: string };
  title?: string;
  files?: OriginalTorrentFile[];
  selectedFile?: OriginalTorrentFile;
  streamUrl?: string;
  error?: OriginalTorrentFailure;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface OriginalTorrentBffConfigResponse {
  enabled: boolean;
}

export type OriginalTorrentSessionQuery = Omit<TorrentDiscoveryQuery, "providers" | "limit">;

export class OriginalTorrentBffError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, options: { status: number; code?: string }) {
    super(message);
    this.name = "OriginalTorrentBffError";
    this.status = options.status;
    this.code = options.code;
  }
}

export function getOriginalTorrentBffConfig(
  signal?: AbortSignal,
): Promise<OriginalTorrentBffConfigResponse> {
  return requestJson<OriginalTorrentBffConfigResponse>(`${BFF_BASE}/config`, {
    method: "GET",
    signal,
  });
}

export function createOriginalTorrentSession(
  query: OriginalTorrentSessionQuery,
  candidate: Pick<TorrentCandidate, "provider" | "id">,
  signal?: AbortSignal,
): Promise<OriginalTorrentSessionSnapshot> {
  return requestJson<OriginalTorrentSessionSnapshot>(`${BFF_BASE}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      observation: { provider: candidate.provider, id: candidate.id },
    }),
    signal,
  });
}

export function getOriginalTorrentSession(
  id: string,
  signal?: AbortSignal,
): Promise<OriginalTorrentSessionSnapshot> {
  return requestJson<OriginalTorrentSessionSnapshot>(sessionPath(id), {
    method: "GET",
    signal,
  });
}

export function selectOriginalTorrentFile(
  id: string,
  fileId: number,
  signal?: AbortSignal,
): Promise<OriginalTorrentSessionSnapshot> {
  return requestJson<OriginalTorrentSessionSnapshot>(`${sessionPath(id)}/selection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId }),
    signal,
  });
}

export async function stopOriginalTorrentSession(
  id: string,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch(sessionPath(id), {
    method: "DELETE",
    keepalive: options.keepalive,
    signal: options.signal,
    headers: { accept: "application/json" },
  });

  if (response.status !== 204) {
    throw await createResponseError(response);
  }
}

export function stopOriginalTorrentSessionBestEffort(id: string): void {
  void stopOriginalTorrentSession(id, { keepalive: true }).catch(() => undefined);
}

export function toOriginalTorrentSessionQuery(
  query: TorrentDiscoveryQuery,
): OriginalTorrentSessionQuery {
  const sessionQuery = { ...query };
  delete sessionQuery.providers;
  delete sessionQuery.limit;
  return sessionQuery;
}

export function resolveOriginalTorrentStreamUrl(path: string): string {
  if (!STREAM_PATH.test(path)) {
    throw new Error("The API returned an invalid torrent stream capability path.");
  }

  return new URL(path, `${getApiBaseUrl().replace(/\/+$/u, "")}/`).toString();
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();

  if (contentType !== "application/json") {
    throw new OriginalTorrentBffError("The torrent session gateway returned invalid data.", {
      status: response.status,
    });
  }

  return (await response.json()) as T;
}

async function createResponseError(response: Response): Promise<OriginalTorrentBffError> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const message = readErrorString(body, "message") ?? "The torrent session request failed.";
  const code = readErrorString(body, "code");

  return new OriginalTorrentBffError(message, {
    status: response.status,
    ...(code === undefined ? {} : { code }),
  });
}

function readErrorString(value: unknown, key: "code" | "message"): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length <= 1_000 ? field : undefined;
}

function sessionPath(id: string): string {
  if (!SESSION_ID.test(id)) {
    throw new Error("The torrent session ID is invalid.");
  }

  return `${BFF_BASE}/sessions/${id}`;
}
