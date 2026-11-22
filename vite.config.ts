import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom" },
  server: { host: "0.0.0.0", proxy: {
    "/api/v1": "http://127.0.0.1:8000",
    "/fastapi": {
      target: "http://127.0.0.1:8001",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/fastapi/, ""),
    },
  } },
});
