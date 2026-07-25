import { hasControlCharacters } from './torrserver/validation';

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

export interface ReferencePlaybackHttpEnv extends NodeJS.ProcessEnv {
  MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN?: string;
}

export interface ReferencePlaybackHttpConfig {
  enabled: boolean;
  token?: string;
}

export function readReferencePlaybackHttpConfig(
  torrServerConfigured: boolean,
  env: ReferencePlaybackHttpEnv = process.env,
): ReferencePlaybackHttpConfig {
  const token = readToken(env.MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN);

  if (torrServerConfigured !== (token !== undefined)) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_URL and MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN must be configured together.',
    );
  }

  return {
    enabled: torrServerConfigured,
    ...(token === undefined ? {} : { token }),
  };
}

function readToken(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  if (
    value.trim() !== value ||
    value.length < MIN_TOKEN_LENGTH ||
    value.length > MAX_TOKEN_LENGTH ||
    [...value].some((character) => character.trim().length === 0) ||
    hasControlCharacters(value)
  ) {
    throw new Error(
      `MEDIA_ENGINE_TORRENT_PLAYBACK_TOKEN must contain ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} non-whitespace, non-control characters.`,
    );
  }

  return value;
}
