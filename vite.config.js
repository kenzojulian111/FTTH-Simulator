import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],

    test: {
        environment: "jsdom",
    },

    server: {
        host: "0.0.0.0",
        proxy: {
            "/api/v1": {
                target: "http://localhost:8000",
                changeOrigin: true,
            },
        },
    },
});