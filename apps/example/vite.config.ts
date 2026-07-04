import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: "node_modules/.vite-media-engine-example",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
