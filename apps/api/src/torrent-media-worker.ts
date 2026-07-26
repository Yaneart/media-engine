import { loadLocalEnv } from './env';
import { readTorrentMediaWorkerServerConfig } from './reference-playback/media-worker-config';
import { createTorrentMediaWorkerServer } from './reference-playback/media-worker-server';
import { readTorrentPlaybackMediaProbeConfig } from './reference-playback/media-probe-config';
import { FfprobeTorrentMediaProbe } from './reference-playback/media-probe';
import {
  TorrServerClient,
  readTorrServerClientConfig,
} from './reference-playback/torrserver';

function start(): void {
  loadLocalEnv();
  const serverConfig = readTorrentMediaWorkerServerConfig();
  const probeConfig = readTorrentPlaybackMediaProbeConfig();
  const torrServerConfig = readTorrServerClientConfig();

  if (probeConfig === undefined) {
    throw new Error(
      'MEDIA_ENGINE_TORRENT_PLAYBACK_FFPROBE_PATH is required by the torrent media worker.',
    );
  }

  if (torrServerConfig === undefined) {
    throw new Error(
      'MEDIA_ENGINE_TORRSERVER_URL is required by the torrent media worker.',
    );
  }

  if (torrServerConfig.username !== undefined) {
    throw new Error(
      'The torrent media worker does not pass TorServer Basic Auth credentials to ffprobe.',
    );
  }

  const client = new TorrServerClient(torrServerConfig);
  const server = createTorrentMediaWorkerServer(
    serverConfig,
    new FfprobeTorrentMediaProbe(probeConfig),
    (hash, fileId) => client.createPlayTarget(hash, fileId),
  );
  let closing = false;

  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close((error) => {
      if (error) {
        console.error('Torrent media worker shutdown failed.', error);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(
      `Torrent media worker listening on ${serverConfig.host}:${serverConfig.port}.`,
    );
  });
}

try {
  start();
} catch (error) {
  console.error('Torrent media worker failed to start.', error);
  process.exitCode = 1;
}
