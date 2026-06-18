import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Disable response buffering for SSE
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, req) => {
            if (req.headers.accept?.includes("text/event-stream")) {
              // Keep connection alive for SSE
            }
          });
        },
      },
    },
  },
});
