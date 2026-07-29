import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const CONFIG_PATH = "/torrent-player/config";
const SESSIONS_PATH = "/torrent-player/sessions";
const SESSION_ID = /^[A-Za-z0-9_-]{32}$/u;
const MAX_REQUEST_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const REQUEST_TIMEOUT_MS = 35_000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

export interface OriginalTorrentBffConfig {
  enabled: boolean;
  apiUrl?: URL;
  token?: string;
}

export interface OriginalTorrentBffEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL?: string;
  MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN?: string;
}

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export function readOriginalTorrentBffConfig(
  env: OriginalTorrentBffEnv = process.env,
): OriginalTorrentBffConfig {
  const token = readToken(env.MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN);

  if (token === undefined) {
    return { enabled: false };
  }

  return {
    enabled: true,
    apiUrl: readApiUrl(env.MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL ?? "http://127.0.0.1:3000"),
    token,
  };
}

export function originalTorrentBffPlugin(
  config: OriginalTorrentBffConfig,
  fetchImplementation: typeof fetch = fetch,
): Plugin {
  const middleware = createOriginalTorrentBffMiddleware(config, fetchImplementation);

  return {
    name: "media-engine-original-torrent-bff",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export function createOriginalTorrentBffMiddleware(
  config: OriginalTorrentBffConfig,
  fetchImplementation: typeof fetch = fetch,
): Middleware {
  return (request, response, next) => {
    const path = readPath(request.url);

    if (path === undefined || !path.startsWith("/torrent-player/")) {
      next();
      return;
    }

    void handleRequest(request, response, path, config, fetchImplementation).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 502, {
          code: "torrent_bff_failed",
          message: "The torrent session gateway failed.",
        });
      } else {
        response.destroy();
      }
    });
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  config: OriginalTorrentBffConfig,
  fetchImplementation: typeof fetch,
): Promise<void> {
  if (request.method === "GET" && path === CONFIG_PATH) {
    sendJson(response, 200, { enabled: config.enabled });
    return;
  }

  const upstreamPath = resolveUpstreamPath(request.method, path);

  if (upstreamPath === undefined) {
    sendJson(response, 404, {
      code: "torrent_bff_route_not_found",
      message: "The torrent player route was not found.",
    });
    return;
  }

  if (!config.enabled || config.apiUrl === undefined || config.token === undefined) {
    sendJson(response, 503, {
      code: "torrserver_unavailable",
      message: "Torrent playback is not configured on the example server.",
    });
    return;
  }

  if (isMutatingMethod(request.method) && !isSameOrigin(request)) {
    sendJson(response, 403, {
      code: "torrent_bff_origin_rejected",
      message: "A same-origin browser request is required.",
    });
    return;
  }

  const body = request.method === "POST" ? await readJsonBody(request) : undefined;

  if (body === false) {
    sendJson(response, 400, {
      code: "torrent_bff_input_invalid",
      message: "The torrent session request must contain bounded JSON.",
    });
    return;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Torrent BFF request timed out."));
  }, REQUEST_TIMEOUT_MS);
  timeout.unref();
  const abortUpstream = () => controller.abort();
  const abortOnClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.once("aborted", abortUpstream);
  response.once("close", abortOnClose);

  try {
    const upstreamResponse = await fetchImplementation(
      new URL(upstreamPath.replace(/^\/+/, ""), config.apiUrl),
      {
        method: request.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: controller.signal,
      },
    );

    if (upstreamResponse.status === 204) {
      await discardUnexpectedBody(upstreamResponse);
      sendEmpty(response, 204);
      return;
    }

    const payload = await readJsonResponse(upstreamResponse);
    sendJson(response, normalizeStatus(upstreamResponse.status), payload);
  } catch {
    sendJson(response, timedOut ? 504 : 502, {
      code: timedOut ? "torrent_bff_timeout" : "torrserver_unavailable",
      message: timedOut
        ? "The torrent session request timed out."
        : "The Media Engine API is unavailable.",
    });
  } finally {
    clearTimeout(timeout);
    request.off("aborted", abortUpstream);
    response.off("close", abortOnClose);
  }
}

function resolveUpstreamPath(method: string | undefined, path: string): string | undefined {
  if (method === "POST" && path === SESSIONS_PATH) {
    return "/media/torrent-sessions";
  }

  const prefix = `${SESSIONS_PATH}/`;

  if (!path.startsWith(prefix)) {
    return undefined;
  }

  const remainder = path.slice(prefix.length);
  const selectionSuffix = "/selection";

  if (method === "POST" && remainder.endsWith(selectionSuffix)) {
    const id = remainder.slice(0, -selectionSuffix.length);
    return SESSION_ID.test(id) ? `/media/torrent-sessions/${id}/selection` : undefined;
  }

  if ((method === "GET" || method === "DELETE") && SESSION_ID.test(remainder)) {
    return `/media/torrent-sessions/${remainder}`;
  }

  return undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown | false> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();

  if (contentType !== "application/json") {
    return false;
  }

  const advertisedLength = Number(request.headers["content-length"]);

  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_REQUEST_BYTES) {
    request.resume();
    return false;
  }

  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;

    if (length > MAX_REQUEST_BYTES) {
      request.resume();
      return false;
    }

    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return false;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();

  if (contentType !== "application/json" || response.body === null) {
    throw new Error("The Media Engine API returned an invalid response.");
  }

  const bytes = await readBoundedBody(response.body);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function discardUnexpectedBody(response: Response): Promise<void> {
  if (response.body !== null) {
    await readBoundedBody(response.body);
  }
}

async function readBoundedBody(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const result = await reader.read();

    if (result.done) break;
    length += result.value.byteLength;

    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("The Media Engine API response is too large.");
    }

    chunks.push(result.value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function isMutatingMethod(method: string | undefined): boolean {
  return method === "POST" || method === "DELETE";
}

function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;

  if (origin === undefined || host === undefined) {
    return false;
  }

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
    const url = new URL(value, "http://torrent-player.local");
    return url.search === "" && url.hash === "" ? url.pathname : undefined;
  } catch {
    return undefined;
  }
}

function normalizeStatus(status: number): number {
  return [200, 202, 400, 401, 403, 404, 409, 429, 502, 503, 504].includes(status) ? status : 502;
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

function sendEmpty(response: ServerResponse, status: number): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

function readApiUrl(value: string): URL {
  const url = new URL(value);

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "MEDIA_ENGINE_ORIGINAL_TORRENT_API_URL must be an HTTP(S) URL without credentials, query, or fragment.",
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
    Array.from(value).some((character) => /\s|\p{Cc}/u.test(character))
  ) {
    throw new Error(
      `MEDIA_ENGINE_ORIGINAL_TORRENT_TOKEN must contain ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} non-whitespace, non-control characters.`,
    );
  }

  return value;
}
