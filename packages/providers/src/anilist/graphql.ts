import { ProviderError } from "@media-engine/core";

import type { ProviderRateLimitGate } from "../shared/index.js";
import { parseRetryAfterMs } from "../shared/retry.js";

interface GraphQlError {
  message?: unknown;
  status?: unknown;
  extensions?: {
    code?: unknown;
    status?: unknown;
    retryAfter?: unknown;
    retryAfterMs?: unknown;
    retryAfterSeconds?: unknown;
    http?: {
      status?: unknown;
      headers?: unknown;
    };
  };
}

// Validates an AniList GraphQL envelope and maps GraphQL errors into provider categories.
// Проверяет AniList GraphQL envelope и преобразует GraphQL errors в категории provider.
export function parseAniListGraphQlData<T extends object>(
  response: unknown,
  rateLimitGate: ProviderRateLimitGate,
): T {
  if (!isRecord(response)) {
    throw invalidGraphQlResponse("AniList returned a non-object GraphQL payload.");
  }

  if (response.errors !== undefined) {
    if (
      !Array.isArray(response.errors) ||
      response.errors.some(
        (error) => !isRecord(error) || typeof error.message !== "string" || !error.message.trim(),
      )
    ) {
      throw invalidGraphQlResponse("AniList returned malformed GraphQL errors.");
    }

    if (response.errors.length > 0) {
      throw mapGraphQlErrors(rateLimitGate, response.errors as GraphQlError[]);
    }
  }

  if (!isRecord(response.data)) {
    throw invalidGraphQlResponse("AniList returned no GraphQL data object.");
  }

  return response.data as T;
}

function mapGraphQlErrors(
  rateLimitGate: ProviderRateLimitGate,
  errors: GraphQlError[],
): ProviderError {
  const statuses = errors.flatMap(getGraphQlStatuses);
  const codes = errors
    .map((error) => normalizeGraphQlCode(error.extensions?.code))
    .filter((code): code is string => Boolean(code));
  const messages = errors
    .map((error) => (typeof error.message === "string" ? error.message.trim() : ""))
    .filter(Boolean);
  const combinedMessage = messages.join(" ");
  const retryAfterMs = errors.map(getGraphQlRetryAfterMs).find((value) => value !== undefined);
  const hasValidationSignal =
    statuses.some((status) => status === 400 || status === 422) ||
    codes.some((code) => /GRAPHQL_VALIDATION|BAD_USER_INPUT|VALIDATION_ERROR/u.test(code)) ||
    /cannot query field|unknown argument|variable.+(?:invalid|required)/iu.test(combinedMessage);
  const isRateLimited =
    statuses.includes(429) ||
    codes.some((code) => /RATE.?LIMIT|TOO.?MANY.?REQUESTS|THROTTL/u.test(code)) ||
    /rate.?limit|too many requests|throttl/iu.test(combinedMessage) ||
    (retryAfterMs !== undefined &&
      !hasValidationSignal &&
      !statuses.some((status) => status >= 500));

  if (isRateLimited) {
    rateLimitGate.defer(retryAfterMs ?? 1_000);

    return new ProviderError({
      provider: "anilist",
      code: "PROVIDER_RATE_LIMITED",
      message: formatGraphQlErrorMessage(messages),
      retryable: true,
      cause: errors,
    });
  }

  const isUnavailable =
    statuses.some((status) => status >= 500) ||
    codes.some((code) =>
      /INTERNAL_SERVER|SERVICE_UNAVAILABLE|GATEWAY_TIMEOUT|UPSTREAM|TIMEOUT/u.test(code),
    ) ||
    /internal server|service unavailable|temporarily unavailable|gateway timeout/iu.test(
      combinedMessage,
    );

  if (isUnavailable) {
    if (retryAfterMs !== undefined) {
      rateLimitGate.defer(retryAfterMs);
    }

    return new ProviderError({
      provider: "anilist",
      code: "PROVIDER_UNAVAILABLE",
      message: formatGraphQlErrorMessage(messages),
      retryable: true,
      cause: errors,
    });
  }

  const isUnauthorized =
    statuses.some((status) => status === 401 || status === 403) ||
    codes.some((code) => /UNAUTHENTICATED|FORBIDDEN|UNAUTHORIZED/u.test(code));

  return new ProviderError({
    provider: "anilist",
    code: isUnauthorized ? "PROVIDER_UNAUTHORIZED" : "PROVIDER_ERROR",
    message: formatGraphQlErrorMessage(messages),
    retryable: false,
    cause: errors,
  });
}

function invalidGraphQlResponse(message: string): ProviderError {
  return new ProviderError({
    provider: "anilist",
    code: "PROVIDER_INVALID_RESPONSE",
    message,
    retryable: false,
  });
}

function getGraphQlStatuses(error: GraphQlError): number[] {
  return [error.status, error.extensions?.status, error.extensions?.http?.status]
    .map(toHttpStatus)
    .filter((status): status is number => status !== undefined);
}

function toHttpStatus(value: unknown): number | undefined {
  const status =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function normalizeGraphQlCode(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

function getGraphQlRetryAfterMs(error: GraphQlError): number | undefined {
  const extensions = error.extensions;
  const exactMilliseconds = toNonNegativeNumber(extensions?.retryAfterMs);

  if (exactMilliseconds !== undefined) {
    return exactMilliseconds;
  }

  const exactSeconds = toNonNegativeNumber(extensions?.retryAfterSeconds);

  if (exactSeconds !== undefined) {
    return exactSeconds * 1_000;
  }

  const genericHint = extensions?.retryAfter;

  if (typeof genericHint === "string" || typeof genericHint === "number") {
    const parsed = parseRetryAfterMs(String(genericHint));

    if (parsed !== undefined) {
      return parsed;
    }
  }

  const headers = extensions?.http?.headers;

  if (isRecord(headers)) {
    const value = headers["retry-after"] ?? headers["Retry-After"];

    if (typeof value === "string" || typeof value === "number") {
      return parseRetryAfterMs(String(value));
    }
  }

  return undefined;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function formatGraphQlErrorMessage(messages: string[]): string {
  return messages[0]
    ? `AniList GraphQL error: ${messages[0]}`
    : "AniList returned a GraphQL error without a message.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
