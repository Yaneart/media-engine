import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const CONFIG_PATH = "/reference-player/config";
const SESSION_PATH = "/reference-player/sessions";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_REQUEST_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 262_144;
const REQUEST_TIMEOUT_MS = 130_000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

export interface ReferencePlayerServerConfig {
  enabled: boolean;
  apiUrl?: URL;
  token?: string;
}

export interface ReferencePlayerServerEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_REFERENCE_PLAYER_API_URL?: string;
  MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN?: string;
}

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export function readReferencePlayerServerConfig(
  env: ReferencePlayerServerEnv = process.env,
): ReferencePlayerServerConfig {
  const token = readToken(env.MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN);

  if (token === undefined) {
    return { enabled: false };
  }

  return {
    enabled: true,
    apiUrl: readApiUrl(env.MEDIA_ENGINE_REFERENCE_PLAYER_API_URL ?? "http://127.0.0.1:3000"),
    token,
  };
}

export function referencePlayerPlugin(
  config: ReferencePlayerServerConfig,
  fetchImplementation: typeof fetch = fetch,
): Plugin {
  const middleware = createReferencePlayerMiddleware(config, fetchImplementation);
  return {
    name: "media-engine-reference-player",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export function createReferencePlayerMiddleware(
  config: ReferencePlayerServerConfig,
  fetchImplementation: typeof fetch = fetch,
): Middleware {
  return (request, response, next) => {
    const path = readPath(request.url);

    if (path === undefined || !path.startsWith("/reference-player/")) {
      next();
      return;
    }

    void handleReferencePlayerRequest(request, response, path, config, fetchImplementation).catch(
      () => {
        if (!response.headersSent) {
          sendJson(response, 502, { message: "Reference playback request failed." });
        } else {
          response.destroy();
        }
      },
    );
  };
}

async function handleReferencePlayerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  config: ReferencePlayerServerConfig,
  fetchImplementation: typeof fetch,
): Promise<void> {
  if (request.method === "GET" && path === CONFIG_PATH) {
    sendJson(response, 200, { enabled: config.enabled });
    return;
  }

  const upstream = resolveLifecycleRequest(request.method, path);

  if (upstream === undefined) {
    sendJson(response, 404, { message: "Reference player route was not found." });
    return;
  }

  if (!config.enabled || config.apiUrl === undefined || config.token === undefined) {
    sendJson(response, 503, { message: "Reference playback is disabled." });
    return;
  }

  if ((request.method === "POST" || request.method === "DELETE") && !isSameOrigin(request)) {
    sendJson(response, 403, { message: "A same-origin browser request is required." });
    return;
  }

  const body = request.method === "POST" ? await readCreateBody(request) : undefined;

  if (body === false) {
    sendJson(response, 400, { message: "Invalid playback session request." });
    return;
  }

  const controller = new AbortController();
  let timeoutFired = false;
  const timeout = setTimeout(() => {
    timeoutFired = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  timeout.unref();
  const onAborted = () => controller.abort();
  const onResponseClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", onAborted);
  response.once("close", onResponseClose);

  try {
    const upstreamResponse = await fetchImplementation(new URL(upstream, config.apiUrl), {
      method: request.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: controller.signal,
    });
    const payload = await readJsonResponse(upstreamResponse);
    sendJson(response, normalizeStatus(upstreamResponse.status), payload);
  } catch {
    sendJson(response, timeoutFired ? 504 : 502, {
      message: timeoutFired
        ? "Reference playback request timed out."
        : "Reference playback API is unavailable.",
    });
  } finally {
    clearTimeout(timeout);
    request.off("aborted", onAborted);
    response.off("close", onResponseClose);
  }
}

function resolveLifecycleRequest(method: string | undefined, path: string): string | undefined {
  if (method === "POST" && path === SESSION_PATH) {
    return "/reference/torrent-playback/sessions";
  }

  const prefix = `${SESSION_PATH}/`;
  if ((method !== "GET" && method !== "DELETE") || !path.startsWith(prefix)) {
    return undefined;
  }

  const sessionId = path.slice(prefix.length);
  return SESSION_ID_PATTERN.test(sessionId)
    ? `/reference/torrent-playback/sessions/${sessionId}`
    : undefined;
}

async function readCreateBody(
  request: IncomingMessage,
): Promise<{ provider: string; candidateId: string; fileId?: number } | false> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;

  const chunks: Buffer[] = [];
  let length = 0;

  const advertisedLength = Number(request.headers["content-length"]);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_REQUEST_BYTES) {
    request.resume();
    return false;
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) {
      request.resume();
      return false;
    }
    chunks.push(buffer);
  }

  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(value)) return false;
    if (Object.keys(value).some((key) => !["provider", "candidateId", "fileId"].includes(key))) {
      return false;
    }
    if (!isBoundedString(value.provider, 128) || !isBoundedString(value.candidateId, 1_024)) {
      return false;
    }
    if (
      value.fileId !== undefined &&
      (typeof value.fileId !== "number" || !Number.isSafeInteger(value.fileId) || value.fileId < 1)
    ) {
      return false;
    }

    return {
      provider: value.provider,
      candidateId: value.candidateId,
      ...(value.fileId === undefined ? {} : { fileId: value.fileId }),
    };
  } catch {
    return false;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Reference playback API returned a non-JSON response.");
  }

  if (response.body === null) {
    throw new Error("Reference playback API returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Reference playback API response is too large.");
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;

  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host === host &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function readPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  try {
    const url = new URL(value, "http://reference-player.local");
    if (url.search || url.hash) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

function normalizeStatus(status: number): number {
  return [200, 201, 400, 401, 404, 409, 429, 502, 503, 504].includes(status) ? status : 502;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function readApiUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "MEDIA_ENGINE_REFERENCE_PLAYER_API_URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function readToken(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.trim() !== value ||
    value.length < MIN_TOKEN_LENGTH ||
    value.length > MAX_TOKEN_LENGTH ||
    [...value].some((character) => /\s|\p{Cc}/u.test(character))
  ) {
    throw new Error(
      `MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN must contain ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} non-whitespace, non-control characters.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}
