import { formatChatCompletionErrorBody } from "./normie-agent-chat";

export function getElevenLabsProxyUrl(): string | null {
  const fromEnv = import.meta.env.VITE_TTS_PROXY_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  return null;
}

export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
};

export async function fetchElevenLabsVoices(opts: {
  proxyUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<ElevenLabsVoice[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.apiKey && opts.apiKey.trim().length > 0) {
    headers["xi-api-key"] = opts.apiKey.trim();
  }
  const base = opts.proxyUrl?.trim() || "https://api.elevenlabs.io";
  const res = await fetch(`${base}/v1/voices`, {
    method: "GET",
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${res.status} ${res.statusText}: ${formatChatCompletionErrorBody(res.status, body)}`,
    );
  }
  const json = (await res.json()) as { voices?: ElevenLabsVoice[] };
  return Array.isArray(json.voices) ? json.voices : [];
}

export async function synthesizeElevenLabsSpeech(opts: {
  proxyUrl?: string;
  text: string;
  voiceId: string;
  modelId: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<Blob> {
  const voiceId = opts.voiceId.trim();
  if (!voiceId) {
    throw new Error("Missing ElevenLabs Voice ID.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "audio/mpeg",
  };
  if (opts.apiKey && opts.apiKey.trim().length > 0) {
    headers["xi-api-key"] = opts.apiKey.trim();
  }

  const base = opts.proxyUrl?.trim() || "https://api.elevenlabs.io";
  const res = await fetch(`${base}/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: opts.text,
      model_id: opts.modelId.trim() || "eleven_turbo_v2_5",
      voice_settings: {
        stability: opts.voiceSettings?.stability ?? 0.45,
        similarity_boost: opts.voiceSettings?.similarity_boost ?? 0.75,
        style: opts.voiceSettings?.style ?? 0.2,
        use_speaker_boost: opts.voiceSettings?.use_speaker_boost ?? true,
      },
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${res.status} ${res.statusText}: ${formatChatCompletionErrorBody(res.status, body)}`,
    );
  }

  return res.blob();
}
