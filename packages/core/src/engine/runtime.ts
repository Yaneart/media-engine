import type { StreamingProvider } from "../streaming/index.js";

// Validates streaming providers and rejects duplicate public names.
// Проверяет streaming-провайдеры и отклоняет дубли публичных имен.
export function validateStreamingProviders(providers: StreamingProvider[]): StreamingProvider[] {
  const names = new Set<string>();

  for (const provider of providers) {
    const name = provider.name.trim();

    if (!name) {
      throw new Error("Streaming provider name is required.");
    }

    if (name !== provider.name) {
      throw new Error(
        `Streaming provider name "${provider.name}" must not include leading or trailing whitespace.`,
      );
    }

    if (names.has(name)) {
      throw new Error(`Streaming provider "${name}" is already registered.`);
    }

    names.add(name);
  }

  return [...providers];
}

// Resolves a provider override without allowing it to exceed the global boundary.
// Выбирает override провайдера, не позволяя ему превысить глобальную границу.
export function resolveProviderTimeoutMs(
  providerName: string,
  timeoutMs: number | undefined,
  providerTimeouts: Readonly<Record<string, number>>,
): number | undefined {
  const providerTimeoutMs = providerTimeouts[providerName];

  if (providerTimeoutMs === undefined) {
    return timeoutMs;
  }

  return timeoutMs === undefined ? providerTimeoutMs : Math.min(timeoutMs, providerTimeoutMs);
}
