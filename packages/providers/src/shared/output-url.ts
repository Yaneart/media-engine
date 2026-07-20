import { isPublicIpAddress } from "./safe-fetch.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

// Normalizes a provider URL before it is exposed through metadata or streaming output.
// Нормализует URL провайдера перед публикацией в metadata или streaming output.
export function normalizeProviderOutputUrl(value: string | null | undefined): string | undefined {
  if (!value || CONTROL_CHARACTERS.test(value)) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      isLiteralLocalTarget(url.hostname)
    ) {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

// Backwards-compatible name for the provider output URL policy.
// Обратно совместимое имя политики provider output URL.
export function normalizePublicHttpUrl(value: string | null | undefined): string | undefined {
  return normalizeProviderOutputUrl(value);
}

function isLiteralLocalTarget(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1"
  ) {
    return true;
  }

  if (hostname.includes(":")) {
    return !isPublicIpAddress(hostname);
  }

  const octets = hostname.split(".").map(Number);

  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return !isPublicIpAddress(hostname);
}
