import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  // Relative URLs in built index.html — fewer broken asset loads on some static hosts
  base: "./",
  plugins: [react()],
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
