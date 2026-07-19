import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { ProviderError } from "@media-engine/core";

const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostnameResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

export type PinnedHttpTransport = (
  url: URL,
  init: RequestInit,
  address: ResolvedAddress,
) => Promise<Response>;

export interface HardenedProviderFetchOptions {
  provider: string;
  maxRedirects?: number;
  resolver?: HostnameResolver;
  transport?: PinnedHttpTransport;
}

// Creates a GET/HEAD fetch that validates every DNS answer and redirect, then pins the connection.
// Создает GET/HEAD fetch с проверкой каждого DNS-ответа/redirect и закреплением соединения.
export function createHardenedProviderFetch(
  options: HardenedProviderFetchOptions,
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolver = options.resolver ?? resolveHostname;
  const transport = options.transport ?? requestPinned;

  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError(
      "Hardened provider fetch maxRedirects must be a non-negative safe integer.",
    );
  }

  return async (input, init = {}) => {
    assertSupportedRequest(init);
    let url = normalizeExternalUrl(options.provider, input);
    const visited = new Set<string>();

    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(url.href)) {
        throw createUnsafeTargetError(options.provider, "redirect loop");
      }
      visited.add(url.href);

      const addresses = await resolveAndValidate(options.provider, url, resolver);
      const response = await transport(url, { ...init, redirect: "manual" }, addresses[0]!);
      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get("location")
        : null;

      if (!location) {
        return response;
      }

      await cancelResponse(response);

      if (redirects >= maxRedirects) {
        throw createUnsafeTargetError(options.provider, "redirect limit exceeded");
      }

      url = normalizeExternalUrl(options.provider, new URL(location, url));
    }
  };
}

// Returns true only for globally routable IPv4/IPv6 unicast addresses.
// Возвращает true только для глобально маршрутизируемых unicast IPv4/IPv6 адресов.
export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const family = isIP(normalized);

  if (family === 4) {
    return isPublicIpv4(normalized);
  }

  if (family !== 6) {
    return false;
  }

  const words = parseIpv6Words(normalized);
  if (!words) {
    return false;
  }

  const embeddedIpv4 = getEmbeddedIpv4(words);
  if (embeddedIpv4) {
    return isPublicIpv4(embeddedIpv4);
  }

  const [first = 0, second = 0] = words;

  if (
    first < 0x2000 ||
    first > 0x3fff ||
    first === 0x2002 ||
    (first === 0x2001 && second <= 0x01ff) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first & 0xfff0) === 0x3ff0
  ) {
    return false;
  }

  return true;
}

async function resolveHostname(hostname: string): Promise<ReadonlyArray<ResolvedAddress>> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

async function resolveAndValidate(
  provider: string,
  url: URL,
  resolver: HostnameResolver,
): Promise<ReadonlyArray<ResolvedAddress>> {
  const hostname = stripIpv6Brackets(url.hostname);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily } as ResolvedAddress]
    : await resolver(hostname);

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => isIP(address) !== family || !isPublicIpAddress(address))
  ) {
    throw createUnsafeTargetError(provider, "non-public DNS address");
  }

  return addresses;
}

function normalizeExternalUrl(provider: string, input: string | URL): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch (error) {
    throw createUnsafeTargetError(provider, "invalid URL", error);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  ) {
    throw createUnsafeTargetError(provider, "unsupported URL target");
  }

  return url;
}

function assertSupportedRequest(init: RequestInit): void {
  const method = (init.method ?? "GET").toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || init.body != null) {
    throw new TypeError(
      "Hardened provider fetch supports only GET and HEAD requests without a body.",
    );
  }
}

function requestPinned(url: URL, init: RequestInit, address: ResolvedAddress): Promise<Response> {
  return new Promise((resolve, reject) => {
    const lookupPinned: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [address]);
        return;
      }
      callback(null, address.address, address.family);
    };
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal: init.signal ?? undefined,
        lookup: lookupPinned,
        agent: false,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            headers.append(name, item);
          }
        }

        const status = incoming.statusCode ?? 500;
        const hasBody =
          init.method?.toUpperCase() !== "HEAD" &&
          status !== 204 &&
          status !== 205 &&
          status !== 304;
        const body = hasBody ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : null;
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers,
          }),
        );
      },
    );

    request.once("error", reject);
    request.end();
  });
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first = 0, second = 0, third = 0] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6Words(address: string): number[] | undefined {
  const doubleColon = address.indexOf("::");
  if (doubleColon !== -1 && doubleColon !== address.lastIndexOf("::")) {
    return undefined;
  }

  const [leftValue, rightValue = ""] =
    doubleColon === -1
      ? [address, ""]
      : [address.slice(0, doubleColon), address.slice(doubleColon + 2)];
  const left = expandIpv4Segment(leftValue ? leftValue.split(":") : []);
  const right = expandIpv4Segment(rightValue ? rightValue.split(":") : []);
  if (!left || !right) {
    return undefined;
  }

  const missing = 8 - left.length - right.length;
  if ((doubleColon === -1 && missing !== 0) || (doubleColon !== -1 && missing < 1)) {
    return undefined;
  }

  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  return words.length === 8 ? words : undefined;
}

function expandIpv4Segment(parts: string[]): number[] | undefined {
  const last = parts.at(-1);
  if (!last?.includes(".")) {
    return parseHexWords(parts);
  }

  const ipv4 = last.split(".").map(Number);
  if (
    ipv4.length !== 4 ||
    ipv4.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
  }

  return parseHexWords([
    ...parts.slice(0, -1),
    ((ipv4[0]! << 8) | ipv4[1]!).toString(16),
    ((ipv4[2]! << 8) | ipv4[3]!).toString(16),
  ]);
}

function parseHexWords(parts: string[]): number[] | undefined {
  const words = parts.map((part) =>
    /^[\da-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : NaN,
  );
  return words.every(Number.isInteger) ? words : undefined;
}

function getEmbeddedIpv4(words: number[]): string | undefined {
  const prefixIsZero = words.slice(0, 5).every((word) => word === 0);
  const isMapped = prefixIsZero && words[5] === 0xffff;
  const isCompatible =
    words.slice(0, 6).every((word) => word === 0) && (words[6] !== 0 || words[7]! > 1);
  const isNat64 =
    words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0);

  if (!isMapped && !isCompatible && !isNat64) {
    return undefined;
  }

  return `${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect cleanup must not hide the policy error or next request.
  }
}

function createUnsafeTargetError(provider: string, reason: string, cause?: unknown): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_INVALID_RESPONSE",
    message: `Provider "${provider}" returned an unsafe external URL (${reason}).`,
    retryable: false,
    cause,
  });
}
