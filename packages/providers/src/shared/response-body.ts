import { ProviderError } from "@media-engine/core";

export interface ReadBoundedResponseBodyOptions {
  signal?: AbortSignal;
  overflow?: "throw" | "truncate";
}

// Reads at most the configured response bytes and cancels the stream as soon as it overflows.
// Читает не больше заданного объема ответа и отменяет stream сразу при переполнении.
export async function readBoundedResponseBytes(
  provider: string,
  response: Response,
  maxBytes: number,
  options: ReadBoundedResponseBodyOptions = {},
): Promise<Uint8Array> {
  assertPositiveByteLimit(maxBytes);
  const overflow = options.overflow ?? "throw";
  const declaredLength = parseContentLength(response.headers.get("content-length"));

  if (overflow === "throw" && declaredLength !== undefined && declaredLength > maxBytes) {
    await cancelBody(response.body);
    throw createOversizedResponseError(provider, maxBytes);
  }

  if (options.signal?.aborted) {
    await cancelBody(response.body, options.signal.reason);
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const onAbort = () => {
    void reader.cancel(options.signal?.reason).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
      }

      if (done) {
        break;
      }

      if (totalBytes + value.byteLength > maxBytes) {
        await cancelReader(reader);

        if (overflow === "truncate") {
          break;
        }

        throw createOversizedResponseError(provider, maxBytes);
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }

    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

// Reads a bounded UTF-8 response body.
// Читает ограниченное UTF-8 тело ответа.
export async function readBoundedResponseText(
  provider: string,
  response: Response,
  maxBytes: number,
  options: ReadBoundedResponseBodyOptions = {},
): Promise<string> {
  const body = await readBoundedResponseBytes(provider, response, maxBytes, options);
  return new TextDecoder().decode(body);
}

function createOversizedResponseError(provider: string, maxBytes: number): ProviderError {
  return new ProviderError({
    provider,
    code: "PROVIDER_RESPONSE_TOO_LARGE",
    message: `Provider "${provider}" response exceeded the ${maxBytes}-byte limit.`,
    retryable: false,
  });
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const length = Number(value);
  return Number.isSafeInteger(length) ? length : undefined;
}

function assertPositiveByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Response body maxBytes must be a positive safe integer.");
  }
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
  reason?: unknown,
): Promise<void> {
  if (!body) {
    return;
  }

  try {
    await body.cancel(reason);
  } catch {
    // Cancellation cleanup must not hide the original response error.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Cancellation cleanup must not hide the original response error.
  }
}
