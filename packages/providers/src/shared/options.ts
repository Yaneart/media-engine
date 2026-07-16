// Resolves a bounded integer option and fails early on unsafe provider configuration.
// Выбирает ограниченную integer-опцию и сразу отклоняет небезопасную конфигурацию провайдера.
export function resolveBoundedIntegerOption(
  value: number | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const normalized = value ?? fallback;

  if (!Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }

  return normalized;
}
