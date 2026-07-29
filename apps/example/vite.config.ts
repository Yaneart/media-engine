import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import {
  originalTorrentBffPlugin,
  readOriginalTorrentBffConfig,
} from "./server/original-torrent-bff.ts";

export default defineConfig(({ mode }) => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const env = loadEnv(mode, repositoryRoot, "");

  return {
    cacheDir: "node_modules/.vite-media-engine-example",
    envDir: repositoryRoot,
    plugins: [react(), originalTorrentBffPlugin(readOriginalTorrentBffConfig(env))],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  };
});
