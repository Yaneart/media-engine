import { ProviderError, type ProviderContext } from "@media-engine/core";
import {
  deferProviderRateLimitFromResponse,
  mapProviderHttpError,
  mapHttpResponseToProviderError,
  normalizePublicHttpUrl,
  type ProviderFetch,
  type ProviderRateLimitGate,
} from "../shared/index.js";
import { readBoundedResponseText } from "../shared/response-body.js";

const MAX_NAVIGATION_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FlixHqHttpConfig {
  baseUrl: string;
  name: string;
  fetch?: ProviderFetch;
  rateLimitGate: ProviderRateLimitGate;
  maxHtmlBytes: number;
  userAgent: string;
}

// Reads only configured-origin FlixHQ pages; redirects are manual and origin-checked per hop.
// Читает только страницы configured origin FlixHQ с ручной проверкой каждого redirect hop.
export async function fetchFlixHqText(
  config: FlixHqHttpConfig,
  initialUrl: URL,
  context: ProviderContext,
  init: RequestInit = {},
): Promise<string> {
  const fetchImpl = config.fetch ?? fetch;
  let url = assertSameOrigin(config, initialUrl);
  const visited = new Set<string>();

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(url.href)) {
        throw createNavigationError(config.name, "redirect loop");
      }
      visited.add(url.href);

      await config.rateLimitGate.wait(context.signal);
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          ...createHeaders(config),
          ...Object.fromEntries(new Headers(init.headers).entries()),
        },
        redirect: "manual",
        signal: context.signal,
      });
      deferProviderRateLimitFromResponse(config.rateLimitGate, response);
      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get("location")
        : null;

      if (location) {
        await cancelResponse(response);
        if (redirects >= MAX_NAVIGATION_REDIRECTS) {
          throw createNavigationError(config.name, "redirect limit exceeded");
        }
        url = assertSameOrigin(config, new URL(location, url));
        continue;
      }

      if (!response.ok) {
        throw mapHttpResponseToProviderError(config.name, response);
      }

      return await readBoundedResponseText(config.name, response, config.maxHtmlBytes, {
        signal: context.signal,
      });
    }
  } catch (error) {
    throw mapProviderHttpError(config.name, error);
  }
}

export function normalizeFlixHqNavigationUrl(
  value: string | null | undefined,
  baseUrl: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    if (!baseUrl) {
      return normalizePublicHttpUrl(value);
    }

    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      (baseUrl && url.origin !== new URL(baseUrl).origin)
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect cleanup must not hide the navigation policy result.
  }
}

function assertSameOrigin(config: FlixHqHttpConfig, url: URL): URL {
  if (normalizeFlixHqNavigationUrl(url.href, config.baseUrl) !== url.href) {
    throw createNavigationError(config.name, "cross-origin navigation");
  }
  return url;
}

function createHeaders(config: FlixHqHttpConfig): Record<string, string> {
  return {
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": config.userAgent,
    Referer: `${config.baseUrl}/`,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function createNavigationError(provider: string, reason: string): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned unsafe FlixHQ navigation (${reason}).`,
    retryable: false,
  });
}
