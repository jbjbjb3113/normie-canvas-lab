import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // Root-hosted on Cloudflare Pages (*.pages.dev) — absolute /assets/... URLs
  base: "/",
  plugins: [react(), cloudflare()],
  resolve: {
    alias: { "@": src },
  },
  server: {
    proxy: {
      // Dev-only: avoids browser CORS when api.normies.art is strict
      "/normies-api": {
        target: "https://api.normies.art",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/normies-api/, ""),
      },
    },
  },
});