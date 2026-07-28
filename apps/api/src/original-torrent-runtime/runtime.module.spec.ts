import { Test } from '@nestjs/testing';
import {
  OriginalTorrentRuntimeModule,
  TORRSERVER_ADAPTER,
} from './runtime.module';
import { TorrServerAdapter } from './torrserver-adapter';

describe('OriginalTorrentRuntimeModule', () => {
  const originalUrl = process.env.MEDIA_ENGINE_TORRSERVER_URL;
  const originalVersion = process.env.MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION;

  afterEach(() => {
    restoreEnv('MEDIA_ENGINE_TORRSERVER_URL', originalUrl);
    restoreEnv('MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION', originalVersion);
  });

  it('provides an explicitly disabled runtime when no URL exists', async () => {
    delete process.env.MEDIA_ENGINE_TORRSERVER_URL;
    const module = await Test.createTestingModule({
      imports: [OriginalTorrentRuntimeModule],
    }).compile();

    expect(module.get(TORRSERVER_ADAPTER)).toBeUndefined();
  });

  it('provides the private adapter when the runtime is configured', async () => {
    process.env.MEDIA_ENGINE_TORRSERVER_URL = 'http://torrserver:8090';
    process.env.MEDIA_ENGINE_TORRSERVER_EXPECTED_VERSION = 'MatriX.141';
    const module = await Test.createTestingModule({
      imports: [OriginalTorrentRuntimeModule],
    }).compile();

    expect(module.get(TORRSERVER_ADAPTER)).toBeInstanceOf(TorrServerAdapter);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
