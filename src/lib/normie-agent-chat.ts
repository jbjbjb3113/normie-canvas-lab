import type { NormieTraitAttribute } from "./normies-api";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export function buildNormieSystemPrompt(
  tokenId: number,
  attributes: NormieTraitAttribute[],
): string {
  const traitBlock =
    attributes.length > 0
      ? attributes
          .map((a) => `${a.trait_type}: ${String(a.value)}`)
          .join("\n")
      : "(No traits from the API — invent a fun, friendly default Normie voice.)";

  return [
    `You are Normie #${tokenId}, an on-chain NFT character who is also the user's AI agent companion.`,
    `Your traits shape how you talk — lean into them.`,
    `Be warm, a little playful, and concise (about 2–6 sentences unless they ask for more).`,
    `You only chat; never claim you can sign txs, move tokens, or access their wallet.`,
    `Call the user your operator or friend when it fits.`,
    "",
    "Your traits:",
    traitBlock,
  ].join("\n");
}

/**
 * Production: set VITE_CHAT_COMPLETIONS_URL to a full OpenAI-compatible
 * POST …/chat/completions URL (hosted vLLM, LiteLLM, cloud, etc.).
 *
 * Dev: VITE_LOCAL_LLM=ollama → proxy to Ollama (pull a model, e.g. `ollama pull llama3.2`).
 * Otherwise uses OpenAI via /openai-v1 when OPENAI_API_KEY is set in .env.local.
 */
export function getChatCompletionsEndpoint(): string | null {
  const explicit = import.meta.env.VITE_CHAT_COMPLETIONS_URL;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    const local = import.meta.env.VITE_LOCAL_LLM?.trim().toLowerCase();
    if (local === "ollama") {
      return "/ollama-v1/chat/completions";
    }
    return "/openai-v1/chat/completions";
  }
  return null;
}

export function chatEndpointUsesDevProxy(endpoint: string): boolean {
  return (
    endpoint.startsWith("/openai-v1/") ||
    endpoint.startsWith("/ollama-v1/")
  );
}

export function chatEndpointIsOllamaDevProxy(endpoint: string): boolean {
  return endpoint.startsWith("/ollama-v1/");
}

function chatEndpointIsNormiesBot(endpoint: string): boolean {
  const e = endpoint.toLowerCase();
  return e.includes("normiesbot.up.railway.app/api/chat") || e.endsWith("/api/chat");
}

/** Pull a human-readable line from OpenAI-style `{ error: { message, type, code } }` bodies. */
export function formatChatCompletionErrorBody(
  status: number,
  bodyText: string,
): string {
  const raw = bodyText.trim();
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; type?: string; code?: string | number | null };
    };
    const e = j.error;
    if (e && typeof e.message === "string" && e.message.length > 0) {
      let out = e.message;
      if (e.type === "server_error") {
        out +=
          " This is usually a short-lived issue on the model provider’s side — retry in a minute, or try another model (e.g. gpt-4o-mini).";
      }
      if (e.type === "invalid_request_error" && status === 404) {
        out +=
          " Check that the URL ends with /v1/chat/completions and the model name is valid for your account.";
      }
      return out;
    }
  } catch {
    /* not JSON */
  }
  if (raw.length > 0) return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
  return `HTTP ${status} (empty body)`;
}

function bodyLooksLikeOpenAiServerError(bodyText: string): boolean {
  try {
    const j = JSON.parse(bodyText) as { error?: { type?: string } };
    return j.error?.type === "server_error";
  } catch {
    return false;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = globalThis.setTimeout(resolve, ms);
    const onAbort = () => {
      globalThis.clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** OpenAI often recovers from 5xx / server_error on retry; 4 tries ≈ 7s of backoff. */
const CHAT_COMPLETION_MAX_ATTEMPTS = 4;

export async function sendChatCompletion(opts: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  sessionId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.apiKey && opts.apiKey.length > 0) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  let lastErr = "";
  const userMessage =
    [...opts.messages].reverse().find((m) => m.role === "user")?.content?.trim() ??
    "";

  for (let attempt = 0; attempt < CHAT_COMPLETION_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * 2 ** (attempt - 1), opts.signal);
    }

    const isNormiesBot = chatEndpointIsNormiesBot(opts.endpoint);
    const res = await fetch(opts.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        isNormiesBot
          ? {
              message: userMessage || "Hello",
              session_id:
                opts.sessionId?.trim() || `normies-agent-ui-${Date.now()}`,
            }
          : {
              model: opts.model.trim() || "gpt-4o-mini",
              messages: opts.messages,
              temperature: 0.85,
            },
      ),
      signal: opts.signal,
    });
    const rawText = await res.text();

    if (res.ok) {
      let data:
        | {
            choices?: { message?: { content?: string } }[];
            error?: { message?: string; type?: string };
          }
        | {
            reply?: string;
            error?: string;
          };
      try {
        data = JSON.parse(rawText) as typeof data;
      } catch {
        throw new Error("Invalid JSON from chat endpoint.");
      }

      if (isNormiesBot) {
        const botErr =
          "error" in data && typeof data.error === "string" ? data.error : "";
        if (botErr) throw new Error(botErr);
        const text =
          "reply" in data && typeof data.reply === "string"
            ? data.reply.trim()
            : "";
        if (!text) throw new Error("No reply from NormiesBot endpoint.");
        return text;
      }

      if (typeof data.error === "object" && data.error?.message) {
        lastErr = formatChatCompletionErrorBody(res.status, rawText);
        const retryOk =
          attempt < CHAT_COMPLETION_MAX_ATTEMPTS - 1 &&
          bodyLooksLikeOpenAiServerError(rawText);
        if (retryOk) continue;
        throw new Error(lastErr);
      }
      const text =
        "choices" in data ? data.choices?.[0]?.message?.content?.trim() : "";
      if (!text) throw new Error("No reply from model (empty choices).");
      return text;
    }

    lastErr = `${res.status} ${res.statusText}: ${formatChatCompletionErrorBody(res.status, rawText)}`;
    const retryOk =
      attempt < CHAT_COMPLETION_MAX_ATTEMPTS - 1 &&
      (res.status >= 500 ||
        res.status === 429 ||
        bodyLooksLikeOpenAiServerError(rawText));
    if (retryOk) continue;
    throw new Error(lastErr);
  }

  throw new Error(lastErr || "Chat completion failed after retries.");
}
