import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// EN: Keep the example app as a small Vite React client for API demos.
// RU: Держим example app небольшим Vite React клиентом для API-демо.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
