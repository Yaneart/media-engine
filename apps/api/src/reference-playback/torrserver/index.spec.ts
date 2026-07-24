import * as torrServerModule from './index';

describe('TorServer private module surface', () => {
  it('exposes the client, config reader, errors, and reviewed defaults together', () => {
    expect(torrServerModule.TorrServerClient).toBeDefined();
    expect(torrServerModule.TorrServerClientError).toBeDefined();
    expect(torrServerModule.isTorrServerClientError).toBeDefined();
    expect(torrServerModule.readTorrServerClientConfig).toBeDefined();
    expect(torrServerModule.DEFAULT_TORRSERVER_CONNECT_TIMEOUT_MS).toBe(3_000);
    expect(torrServerModule.DEFAULT_TORRSERVER_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(torrServerModule.DEFAULT_TORRSERVER_METADATA_TIMEOUT_MS).toBe(
      30_000,
    );
    expect(torrServerModule.DEFAULT_TORRSERVER_MAX_CONCURRENCY).toBe(4);
  });
});
