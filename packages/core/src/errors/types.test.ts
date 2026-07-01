import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaEngineError, ProviderError, toMediaEngineError, toProviderFailure } from "./types.js";

test("keeps existing media engine errors unchanged", () => {
  const error = new MediaEngineError({
    code: "INVALID_QUERY",
    message: "Query must include title or ids.",
  });

  assert.equal(toMediaEngineError(error), error);
});

test("maps provider errors to media engine errors", () => {
  const providerError = new ProviderError({
    provider: "tmdb",
    code: "PROVIDER_TIMEOUT",
    retryable: true,
    message: "TMDB timed out.",
  });

  const error = toMediaEngineError(providerError);

  assert.equal(error.name, "MediaEngineError");
  assert.equal(error.code, "PROVIDER_ERROR");
  assert.equal(error.message, "TMDB timed out.");
  assert.equal(error.cause, providerError);
});

test("maps regular errors to unknown media engine errors", () => {
  const cause = new Error("Unexpected failure.");
  const error = toMediaEngineError(cause);

  assert.equal(error.code, "UNKNOWN_ERROR");
  assert.equal(error.message, "Unexpected failure.");
  assert.equal(error.cause, cause);
});

test("maps non-error thrown values to unknown media engine errors", () => {
  const error = toMediaEngineError("boom");

  assert.equal(error.code, "UNKNOWN_ERROR");
  assert.equal(error.message, "Unknown error");
  assert.equal(error.cause, "boom");
});

test("preserves provider error metadata in provider failures", () => {
  const error = new ProviderError({
    provider: "shikimori",
    code: "PROVIDER_RATE_LIMITED",
    retryable: true,
    message: "Rate limited.",
  });

  assert.deepEqual(toProviderFailure("fallback-name", error), {
    provider: "shikimori",
    code: "PROVIDER_RATE_LIMITED",
    retryable: true,
    message: "Rate limited.",
  });
});

test("maps regular provider failures predictably", () => {
  assert.deepEqual(toProviderFailure("tmdb", new Error("Network failed.")), {
    provider: "tmdb",
    code: "PROVIDER_ERROR",
    retryable: false,
    message: "Network failed.",
  });
});

test("maps unknown provider failures predictably", () => {
  assert.deepEqual(toProviderFailure("tmdb", null), {
    provider: "tmdb",
    code: "PROVIDER_ERROR",
    retryable: false,
    message: "Unknown provider error",
  });
});
