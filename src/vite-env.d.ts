/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NORMIES_API_BASE: string;
  /** Full URL to OpenAI-compatible POST .../chat/completions (production). */
  readonly VITE_CHAT_COMPLETIONS_URL?: string;
  /** Dev only: `ollama` -> use local Ollama OpenAI-compatible API (see vite proxy). */
  readonly VITE_LOCAL_LLM?: string;
  /** Optional server URL that proxies ElevenLabs TTS (recommended for shared key). */
  readonly VITE_TTS_PROXY_URL?: string;
  /** Optional SERC-specific knowledge chat endpoint (defaults to NormiesBot). */
  readonly VITE_SERC_KNOWLEDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
