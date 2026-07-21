import { readFileSync } from "node:fs";

const coreManifest = JSON.parse(
  readFileSync(new URL("../packages/core/package.json", import.meta.url), "utf8"),
);

export const MEDIA_ENGINE_SMOKE_VERSION = coreManifest.version;

export function createSmokeUserAgent(name) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    throw new TypeError(`Invalid smoke User-Agent name ${JSON.stringify(name)}.`);
  }

  return `MediaEngine${name}/${MEDIA_ENGINE_SMOKE_VERSION} (+https://github.com/Yaneart/media-engine)`;
}
