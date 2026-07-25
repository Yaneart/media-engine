import { createHash, timingSafeEqual } from 'node:crypto';
import type { ReferencePlaybackHttpConfig } from './http-config';
import type { TorrServerHealth, TorrServerRequestOptions } from './torrserver';

const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

export interface ReferencePlaybackHealth {
  status: 'disabled' | 'ok' | 'unavailable';
  version?: string;
}

export interface ReferencePlaybackHealthClient {
  health(options?: TorrServerRequestOptions): Promise<TorrServerHealth>;
}

export class ReferencePlaybackRuntime {
  private readonly tokenDigest: Buffer | undefined;
  private readonly configuredEnabled: boolean;

  constructor(
    readonly client: ReferencePlaybackHealthClient | undefined,
    config: ReferencePlaybackHttpConfig,
  ) {
    this.configuredEnabled = config.enabled;
    this.tokenDigest =
      config.token === undefined ? undefined : digestToken(config.token);
  }

  get enabled(): boolean {
    return (
      this.configuredEnabled &&
      this.client !== undefined &&
      this.tokenDigest !== undefined
    );
  }

  authorizeBearer(header: string | undefined): boolean {
    if (!this.enabled || header === undefined) {
      return false;
    }

    const match = BEARER_PATTERN.exec(header);

    if (match?.[1] === undefined) {
      return false;
    }

    return timingSafeEqual(digestToken(match[1]), this.tokenDigest!);
  }

  async health(
    options: TorrServerRequestOptions = {},
  ): Promise<ReferencePlaybackHealth> {
    if (!this.enabled) {
      return { status: 'disabled' };
    }

    try {
      return {
        status: 'ok',
        version: (await this.client!.health(options)).version,
      };
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : error;
      }

      return { status: 'unavailable' };
    }
  }
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
