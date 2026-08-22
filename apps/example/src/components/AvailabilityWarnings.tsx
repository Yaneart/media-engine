import type { AvailabilityResponse } from "../api";
import { formatProviderFailure } from "../utils/format";

export function AvailabilityWarnings({ response }: { response: AvailabilityResponse }) {
  const failures = response.meta?.providers.failed ?? [];
  if (failures.length === 0) return null;

  return (
    <details className="provider-warnings">
      <summary>Некоторые источники не ответили: {failures.length}</summary>
      <ul className="provider-failures">
        {failures.map((failure) => (
          <li key={`${failure.provider}:${failure.code}`}>{formatProviderFailure(failure)}</li>
        ))}
      </ul>
    </details>
  );
}
