import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const ollamaOrigin =
    env.OLLAMA_HOST?.trim().replace(/\/$/, "") || "http://127.0.0.1:11434";

  return {
    // Root-hosted on Cloudflare Pages (*.pages.dev) — absolute /assets/... URLs
    base: "/",
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
        // Dev: OpenAI-compatible Ollama API (/v1/chat/completions). No API key.
        "/ollama-v1": {
          target: ollamaOrigin,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ollama-v1/, "/v1"),
        },
        // Dev-only: OpenAI blocks browser CORS; inject key from .env.local (never VITE_*).
        ...(openaiKey
          ? {
              "/openai-v1": {
                target: "https://api.openai.com/v1",
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/openai-v1/, ""),
                configure(proxy) {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.setHeader("Authorization", `Bearer ${openaiKey}`);
                  });
                },
              },
            }
          : {}),
      },
    },
  };
});
