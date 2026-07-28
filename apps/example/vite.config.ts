import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(() => {
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

  return {
    cacheDir: "node_modules/.vite-media-engine-example",
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  };
});
