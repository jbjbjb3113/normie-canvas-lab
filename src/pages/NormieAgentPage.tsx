import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { NormiesHeaderArt } from "../components/NormiesHeaderArt";
import { SiteNav } from "../components/SiteNav";
import {
  buildNormieSystemPrompt,
  chatEndpointIsOllamaDevProxy,
  chatEndpointUsesDevProxy,
  getChatCompletionsEndpoint,
  sendChatCompletion,
  type ChatMessage,
} from "../lib/normie-agent-chat";
import {
  fetchElevenLabsVoices,
  getElevenLabsProxyUrl,
  synthesizeElevenLabsSpeech,
  type ElevenLabsVoice,
} from "../lib/normie-agent-tts";
import { Normie3DViewer, type Normie3DLoadParams } from "../components/Normie3DViewer";
import {
  fetchHolderTokenIds,
  fetchNormieTraits,
  normalizeWalletAddress,
} from "../lib/normies-api";
import "../App.css";

const API_KEY_STORAGE = "normie-agent-api-key";
const ELEVEN_KEY_STORAGE = "normie-agent-eleven-api-key";
const ELEVEN_VOICE_STORAGE = "normie-agent-eleven-voice-id";
const ELEVEN_MODEL_STORAGE = "normie-agent-eleven-model-id";
const ELEVEN_MODE_STORAGE = "normie-agent-eleven-mode";
const MOUTH_X_STORAGE = "normie-agent-mouth-x";
const MOUTH_Y_STORAGE = "normie-agent-mouth-y";
const MOUTH_W_STORAGE = "normie-agent-mouth-w";
const MOUTH_H_STORAGE = "normie-agent-mouth-h";
const MOUTH_LINE_H_STORAGE = "normie-agent-mouth-line-h";
const ELEVEN_AUTO_GENDER_STORAGE = "normie-agent-eleven-auto-gender";
const ELEVEN_DYNAMIC_STORAGE = "normie-agent-eleven-dynamic";
const ELEVEN_MALE_VOICE_ID = "pNInz6obpgDQGcFmaJgB";
const ELEVEN_FEMALE_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const SERC_TOKEN_ID = 4354;
const SERC_KNOWLEDGE_ENDPOINT_DEFAULT = "https://normiesbot.up.railway.app/api/chat";
const FORCED_TOKEN_VOICES: Record<number, string> = {
  [SERC_TOKEN_ID]: "DicKhqTSSypNTAkYn5aN",
};
const SERC_MESSAGE_PILLARS = [
  "Normies are living assets: identity, memory, voice, and behavior.",
  "We build in public so the community shapes the product in real time.",
  "Customization on-chain is the moat: provenance plus expression.",
  "Agent NFTs are the next interface layer between culture and software.",
  "SERC is about execution: ship, learn, tighten, repeat.",
] as const;

type BrowserSpeechRec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => BrowserSpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRec;
    webkitSpeechRecognition?: new () => BrowserSpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function validTokenId(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 9999;
}

function traitIndicatesEyewear(value: string): boolean {
  return /(shade|glasses|goggle|visor|monocle|eyepatch)/i.test(value);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function mouthLookKey(wallet: string, tokenId: number): string {
  return `normie-agent-mouth-look:${wallet}:${tokenId}`;
}

function mouthLookTokenKey(tokenId: number): string {
  return `normie-agent-mouth-look:token:${tokenId}`;
}

function voiceKey(wallet: string, tokenId: number): string {
  return `normie-agent-voice:${wallet}:${tokenId}`;
}

function voiceTokenKey(tokenId: number): string {
  return `normie-agent-voice:token:${tokenId}`;
}

function forcedVoiceForToken(tokenId: number | null): string | null {
  if (tokenId === null) return null;
  const v = FORCED_TOKEN_VOICES[tokenId];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function makeSessionId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* ignore */
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function renderChatContent(content: string): ReactNode[] {
  const imageUrlRe = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp))/gi;
  const out: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = imageUrlRe.exec(content)) !== null) {
    const [url] = m;
    const start = m.index;
    if (start > last) {
      out.push(<span key={`txt-${idx++}`}>{content.slice(last, start)}</span>);
    }
    out.push(
      <a
        key={`img-link-${idx++}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="normie-agent__inline-media-link"
      >
        <img src={url} alt="Shared image" className="normie-agent__inline-media" />
      </a>,
    );
    last = start + url.length;
  }
  if (last < content.length) {
    out.push(<span key={`txt-${idx++}`}>{content.slice(last)}</span>);
  }
  return out.length > 0 ? out : [content];
}

function stripUrlsForSpeech(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, " [shared image] ");
}

function normalizeSercReply(reply: string): string {
  let out = reply.trim();
  if (!out) return out;
  const mentionedSerc = /\bserc\b/i.test(out);
  out = out.replace(/\u2019/g, "'");
  out = out
    .replace(/\bSerc is\b/gi, "I'm")
    .replace(/\bSERC is\b/g, "I'm")
    .replace(/\bSerc's\b/gi, "my")
    .replace(/\bSERC's\b/g, "my")
    .replace(/\bSerc\b/gi, "I")
    .replace(/\bSERC\b/g, "I")
    .replace(/\bhe's\b/gi, "I'm")
    .replace(/\bhe is\b/gi, "I am")
    .replace(/\bhe\b/gi, "I")
    .replace(/\bhis\b/gi, "my")
    .replace(/\bhim\b/gi, "me")
    .replace(/\bhimself\b/gi, "myself");

  // Clean frequent grammar slips after pronoun conversion.
  out = out
    .replace(/\bI\s+is\b/g, "I am")
    .replace(/\bI'm\b([^.!?]{0,80}?)\band is\b/gi, "I'm$1and I'm")
    .replace(/\bI\s+also\b/gi, "I also");

  if (mentionedSerc && !/\bthat'?s me\b/i.test(out)) {
    out = `That's me. ${out}`;
  }
  return out;
}

type VoiceDynamics = {
  label: string;
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
};

type GeneratedBackground = {
  label: string;
  image: string;
};

type OverlayKind = "idle" | "emote" | "math" | "energy" | "soft";

function hashText(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generatedBackgroundFromSeed(seedText: string, tokenId: number | null): GeneratedBackground {
  const seed = hashText(`${seedText}|${tokenId ?? "none"}`);
  const h1 = seed % 360;
  const h2 = (h1 + 48 + ((seed >>> 8) % 120)) % 360;
  const h3 = (h2 + 60 + ((seed >>> 16) % 120)) % 360;
  const sat = 52 + ((seed >>> 5) % 22);
  const l1 = 10 + ((seed >>> 12) % 12);
  const l2 = 20 + ((seed >>> 20) % 16);
  const l3 = 14 + ((seed >>> 24) % 18);
  return {
    label: `bg-${h1}-${h2}`,
    image: `radial-gradient(120% 90% at 16% 20%, hsla(${h1}, ${sat}%, ${l2 + 10}%, 0.55), transparent 56%),
      radial-gradient(90% 80% at 86% 14%, hsla(${h2}, ${sat - 6}%, ${l2 + 6}%, 0.45), transparent 58%),
      linear-gradient(145deg, hsl(${h1}, ${sat}%, ${l1}%), hsl(${h2}, ${sat - 4}%, ${l2}%) 52%, hsl(${h3}, ${sat - 10}%, ${l3}%))`,
  };
}

/**
 * Classify a reply for pixel scribble + optional background vibe (keyword-only, no ML).
 * Order: math → soft (gently negative) → energy → emote → idle
 */
function replyOverlayKind(text: string): OverlayKind {
  const t = text.toLowerCase();
  if (
    /(\d+\s*[\+\-\*\/=×÷]\s*\d+)|\b(math|equation|solve|integral|sum|matrix|calculate|theorem|sqrt)\b/.test(
      t,
    )
  ) {
    return "math";
  }
  const hasPositive =
    /(\blol\b|haha|hehe|rofl|lmao|lmfao|love|heart|❤|cute|happy|yay|yippie|wonderful|grateful|great|awesome|amazing|thanks|thx|ty|:\)|:d|\^\^)/.test(
      t,
    );
  const hasSoft =
    /\b(sad|sorrow|sorry|worry|worried|anxious|nervous|hate|terrible|awful|depress|anxiety|fear|scared|afraid|ugh|disappoint|upset|cry|cried|tears|fml|stressed)\b|(\bRIP\b)/i.test(
      t,
    );
  if (hasSoft && !hasPositive) {
    return "soft";
  }
  if (
    /(\bhype\b|\bfire\b|insane|crazy|\blfg\b|moon(ing)?|pump|rocket|banger|bangers|gigabrain|huge|yuge|sweep|sweeping|energy|boost|jacked|amped)/.test(
      t,
    ) ||
    (t.match(/!/g)?.length ?? 0) >= 2
  ) {
    return "energy";
  }
  if (
    hasPositive ||
    /(cute|heart|adorable|beautiful|wholesome|blessed|yay|party|hug)/.test(t)
  ) {
    return "emote";
  }
  return "idle";
}

function drawOverlayPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 2,
) {
  ctx.fillRect(x, y, size, size);
}

function drawPixelScribble(
  canvas: HTMLCanvasElement,
  kind: OverlayKind,
  seedText: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = 80;
  const H = 80;
  canvas.width = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  const seed = hashText(seedText);
  const dark = "rgba(72,73,75,0.95)";
  const light = "rgba(227,229,228,0.95)";
  ctx.fillStyle = seed % 2 === 0 ? dark : light;

  if (kind === "idle") {
    // Subtle centered dots so it's visibly alive.
    drawOverlayPixel(ctx, 38, 38, 2);
    drawOverlayPixel(ctx, 42, 38, 2);
    drawOverlayPixel(ctx, 40, 42, 2);
    return;
  }

  if (kind === "emote") {
    // Big pixel heart near upper-center.
    const pts = [
      [36, 16],
      [38, 16],
      [42, 16],
      [44, 16],
      [34, 18],
      [46, 18],
      [34, 20],
      [46, 20],
      [36, 22],
      [44, 22],
      [38, 24],
      [42, 24],
      [40, 26],
      [38, 28],
      [42, 28],
      [40, 30],
    ];
    for (const [x, y] of pts) drawOverlayPixel(ctx, x, y, 3);
    return;
  }

  if (kind === "math") {
    // Bold equation-like strokes in center.
    const y = 18 + ((seed >>> 4) % 6);
    for (let x = 24; x < 56; x += 3) drawOverlayPixel(ctx, x, y, 2);
    drawOverlayPixel(ctx, 30, y + 8, 3);
    drawOverlayPixel(ctx, 36, y + 8, 3);
    for (let x = 42; x < 54; x += 2) drawOverlayPixel(ctx, x, y + 8, 2);
    for (let x = 42; x < 54; x += 2) drawOverlayPixel(ctx, x, y + 12, 2);
    drawOverlayPixel(ctx, 56, y + 10, 3);
    return;
  }

  // energy
  let x = 34 + (seed % 8);
  let y = 10;
  for (let i = 0; i < 20; i++) {
    drawOverlayPixel(ctx, x, y, 3);
    x += i % 2 === 0 ? 4 : -3;
    y += 3;
    if (x < 20) x = 20;
    if (x > 60) x = 60;
  }
}

function buildVoiceDynamics(age: string | null, gender: string | null): VoiceDynamics {
  const a = (age ?? "").toLowerCase();
  const g = (gender ?? "").toLowerCase();
  if (a.includes("young")) {
    return {
      label: `${g || "normie"} young`,
      settings: {
        stability: 0.3,
        similarity_boost: 0.78,
        style: 0.42,
        use_speaker_boost: true,
      },
    };
  }
  if (a.includes("old")) {
    return {
      label: `${g || "normie"} old`,
      settings: {
        stability: 0.68,
        similarity_boost: 0.7,
        style: 0.1,
        use_speaker_boost: true,
      },
    };
  }
  return {
    label: `${g || "normie"} middle-aged/default`,
    settings: {
      stability: 0.48,
      similarity_boost: 0.75,
      style: 0.22,
      use_speaker_boost: true,
    },
  };
}

export function NormieAgentPage() {
  const endpoint = useMemo(() => getChatCompletionsEndpoint(), []);
  const sercKnowledgeEndpoint = useMemo(() => {
    const fromEnv = import.meta.env.VITE_SERC_KNOWLEDGE_URL;
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
      return fromEnv.trim().replace(/\/$/, "");
    }
    return SERC_KNOWLEDGE_ENDPOINT_DEFAULT;
  }, []);
  const usesProxy = endpoint ? chatEndpointUsesDevProxy(endpoint) : false;
  const ollamaDev = endpoint ? chatEndpointIsOllamaDevProxy(endpoint) : false;
  const elevenProxyUrl = useMemo(() => getElevenLabsProxyUrl(), []);

  const [tokenInput, setTokenInput] = useState("9098");
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [hasEyewear, setHasEyewear] = useState(false);
  const [forceEyes, setForceEyes] = useState(false);
  const [normieGender, setNormieGender] = useState<string | null>(null);
  const [normieAge, setNormieAge] = useState<string | null>(null);
  const [visualMode, setVisualMode] = useState<"2d" | "3d">("2d");
  const [showMouthPicker, setShowMouthPicker] = useState(false);
  const [autoNormieBackground, setAutoNormieBackground] = useState(true);
  const [generatedBackground, setGeneratedBackground] = useState<GeneratedBackground>(
    () => generatedBackgroundFromSeed("normie idle", 9098),
  );
  const [overlayAuto, setOverlayAuto] = useState(true);
  const [overlayKind, setOverlayKind] = useState<OverlayKind>("idle");
  const [overlaySeedText, setOverlaySeedText] = useState("normie idle");
  const [mouthX, setMouthX] = useState(() => {
    try {
      const raw = Number.parseFloat(sessionStorage.getItem(MOUTH_X_STORAGE) ?? "");
      return Number.isFinite(raw) ? raw : 51;
    } catch {
      return 51;
    }
  });
  const [mouthY, setMouthY] = useState(() => {
    try {
      const raw = Number.parseFloat(sessionStorage.getItem(MOUTH_Y_STORAGE) ?? "");
      return Number.isFinite(raw) ? raw : 58;
    } catch {
      return 58;
    }
  });
  const [mouthW, setMouthW] = useState(() => {
    try {
      const raw = Number.parseFloat(sessionStorage.getItem(MOUTH_W_STORAGE) ?? "");
      return Number.isFinite(raw) ? raw : 12.5;
    } catch {
      return 12.5;
    }
  });
  const [mouthH, setMouthH] = useState(() => {
    try {
      const raw = Number.parseFloat(sessionStorage.getItem(MOUTH_H_STORAGE) ?? "");
      return Number.isFinite(raw) ? raw : 2.7;
    } catch {
      return 2.7;
    }
  });
  const [mouthLineH, setMouthLineH] = useState(() => {
    try {
      const raw = Number.parseFloat(
        sessionStorage.getItem(MOUTH_LINE_H_STORAGE) ?? "",
      );
      return Number.isFinite(raw) ? raw : 8;
    } catch {
      return 8;
    }
  });
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingTraits, setLoadingTraits] = useState(false);

  const [walletInput, setWalletInput] = useState("");
  const [holderIds, setHolderIds] = useState<number[]>([]);
  const [holderError, setHolderError] = useState<string | null>(null);
  const [loadingHolders, setLoadingHolders] = useState(false);

  const [model, setModel] = useState(() =>
    import.meta.env.DEV &&
    import.meta.env.VITE_LOCAL_LLM?.trim().toLowerCase() === "ollama"
      ? "llama3.2"
      : "gpt-4o-mini",
  );
  const [apiKey, setApiKey] = useState(() => {
    try {
      return sessionStorage.getItem(API_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });
  const persistKey = useCallback((v: string) => {
    setApiKey(v);
    try {
      if (v) sessionStorage.setItem(API_KEY_STORAGE, v);
      else sessionStorage.removeItem(API_KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }, []);
  const [elevenApiKey, setElevenApiKey] = useState(() => {
    try {
      return sessionStorage.getItem(ELEVEN_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });
  const persistElevenApiKey = useCallback((v: string) => {
    setElevenApiKey(v);
    try {
      if (v) sessionStorage.setItem(ELEVEN_KEY_STORAGE, v);
      else sessionStorage.removeItem(ELEVEN_KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }, []);
  const [elevenUseServerKey, setElevenUseServerKey] = useState(() => {
    try {
      return sessionStorage.getItem(ELEVEN_MODE_STORAGE) !== "user";
    } catch {
      return true;
    }
  });
  const [elevenVoiceId, setElevenVoiceId] = useState(() => {
    try {
      return (
        sessionStorage.getItem(ELEVEN_VOICE_STORAGE) ?? "EXAVITQu4vr4xnSDxMaL"
      );
    } catch {
      return "EXAVITQu4vr4xnSDxMaL";
    }
  });
  const [elevenModelId, setElevenModelId] = useState(() => {
    try {
      return sessionStorage.getItem(ELEVEN_MODEL_STORAGE) ?? "eleven_turbo_v2_5";
    } catch {
      return "eleven_turbo_v2_5";
    }
  });
  const [autoVoiceByGender, setAutoVoiceByGender] = useState(() => {
    try {
      return sessionStorage.getItem(ELEVEN_AUTO_GENDER_STORAGE) !== "0";
    } catch {
      return true;
    }
  });
  const [autoVoiceDynamics, setAutoVoiceDynamics] = useState(() => {
    try {
      return sessionStorage.getItem(ELEVEN_DYNAMIC_STORAGE) !== "0";
    } catch {
      return true;
    }
  });
  const [elevenVoices, setElevenVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingElevenVoices, setLoadingElevenVoices] = useState(false);
  const [elevenVoicesError, setElevenVoicesError] = useState<string | null>(null);
  const [isVamping, setIsVamping] = useState(false);
  const [vampText, setVampText] = useState(
    "La la la... tuning my vibe while you adjust my look.",
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [normiePoppedOut, setNormiePoppedOut] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [mouthLevel, setMouthLevel] = useState(0);
  const forcedVoiceId = useMemo(() => forcedVoiceForToken(loadedId), [loadedId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sercSessionIdRef = useRef<string>(makeSessionId("serc"));
  const speechRecRef = useRef<BrowserSpeechRec | null>(null);
  const speechGuardTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const overlayCanvasMainRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasPopRef = useRef<HTMLCanvasElement | null>(null);
  const mouthSmoothedRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(ELEVEN_VOICE_STORAGE, elevenVoiceId);
      sessionStorage.setItem(ELEVEN_MODEL_STORAGE, elevenModelId);
      sessionStorage.setItem(
        ELEVEN_MODE_STORAGE,
        elevenUseServerKey ? "server" : "user",
      );
      sessionStorage.setItem(
        ELEVEN_AUTO_GENDER_STORAGE,
        autoVoiceByGender ? "1" : "0",
      );
      sessionStorage.setItem(
        ELEVEN_DYNAMIC_STORAGE,
        autoVoiceDynamics ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }, [
    autoVoiceByGender,
    autoVoiceDynamics,
    elevenModelId,
    elevenUseServerKey,
    elevenVoiceId,
  ]);

  useEffect(() => {
    // If a proxy is configured, default to server-key mode unless user explicitly
    // supplied their own key for this session.
    if (!elevenProxyUrl) return;
    if (!elevenApiKey.trim()) {
      setElevenUseServerKey(true);
    }
  }, [elevenApiKey, elevenProxyUrl]);

  const dynamicVoice = useMemo(
    () => buildVoiceDynamics(normieAge, normieGender),
    [normieAge, normieGender],
  );
  const show3D = false;
  const agent3DLoadParams: Normie3DLoadParams | null =
    loadedId === null
      ? null
      : {
          tokenId: loadedId,
          useOriginalSvg: false,
          extrudeDepth: 2,
          bevel: false,
          includeBackgroundPlate: true,
        };

  const remixBackground = useCallback((seedText: string) => {
    setGeneratedBackground(generatedBackgroundFromSeed(seedText, loadedId));
  }, [loadedId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MOUTH_X_STORAGE, String(mouthX));
      sessionStorage.setItem(MOUTH_Y_STORAGE, String(mouthY));
      sessionStorage.setItem(MOUTH_W_STORAGE, String(mouthW));
      sessionStorage.setItem(MOUTH_H_STORAGE, String(mouthH));
      sessionStorage.setItem(MOUTH_LINE_H_STORAGE, String(mouthLineH));
    } catch {
      /* ignore */
    }
  }, [mouthH, mouthLineH, mouthW, mouthX, mouthY]);

  useEffect(() => {
    if (loadedId === null) return;
    try {
      const payload = JSON.stringify({
        x: mouthX,
        y: mouthY,
        w: mouthW,
        h: mouthH,
        lineH: mouthLineH,
      });
      localStorage.setItem(mouthLookTokenKey(loadedId), payload);
      const wallet = normalizeWalletAddress(walletInput);
      if (wallet) {
        localStorage.setItem(mouthLookKey(wallet, loadedId), payload);
      }
    } catch {
      /* ignore */
    }
  }, [loadedId, mouthH, mouthLineH, mouthW, mouthX, mouthY, walletInput]);

  useEffect(() => {
    return () => {
      if (speechGuardTimerRef.current !== null) {
        window.clearTimeout(speechGuardTimerRef.current);
        speechGuardTimerRef.current = null;
      }
      try {
        speechRecRef.current?.stop();
      } catch {
        speechRecRef.current?.abort?.();
      }
      speechRecRef.current = null;
      const current = audioRef.current;
      if (current) current.pause();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    if (show3D) return;
    const draw = (el: HTMLCanvasElement | null) => {
      if (el) drawPixelScribble(el, overlayKind, overlaySeedText);
    };
    draw(overlayCanvasMainRef.current);
    draw(overlayCanvasPopRef.current);
  }, [overlayKind, overlaySeedText, show3D]);

  useEffect(() => {
    if (!normiePoppedOut) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setNormiePoppedOut(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [normiePoppedOut]);

  useEffect(() => {
    if (!showMouthPicker) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setShowMouthPicker(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showMouthPicker]);

  const recCtor = useMemo(() => getSpeechRecognitionCtor(), []);
  const startListening = useCallback(() => {
    if (!recCtor || listening) return;
    if (!loadedId || sending || !endpoint) {
      setChatError("Load a Normie and make sure chat is ready before using Mic.");
      return;
    }
    if (speechGuardTimerRef.current !== null) {
      window.clearTimeout(speechGuardTimerRef.current);
      speechGuardTimerRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        speechRecRef.current.abort?.();
      }
      speechRecRef.current = null;
    }
    const rec = new recCtor();
    speechRecRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setChatError(null);
    rec.onresult = (ev) => {
      const said = ev.results[0]?.[0]?.transcript?.trim() ?? "";
      if (said)
        setDraft((d) => (d ? `${d.trimEnd()} ${said}` : said));
    };
    rec.onerror = (ev) => {
      setListening(false);
      const reason = ev.error ? ` (${ev.error})` : "";
      setChatError(`Mic recognition failed${reason}. Check browser mic permission.`);
    };
    rec.onend = () => {
      setListening(false);
      if (speechGuardTimerRef.current !== null) {
        window.clearTimeout(speechGuardTimerRef.current);
        speechGuardTimerRef.current = null;
      }
      if (speechRecRef.current === rec) speechRecRef.current = null;
    };
    try {
      setListening(true);
      rec.start();
      speechGuardTimerRef.current = window.setTimeout(() => {
        // Guard against browser recognition getting stuck in listening state.
        try {
          rec.stop();
        } catch {
          rec.abort?.();
        }
        setListening(false);
      }, 15000);
    } catch {
      setListening(false);
      speechRecRef.current = null;
      setChatError("Mic could not start. Check browser support and permissions.");
    }
  }, [endpoint, listening, loadedId, recCtor, sending]);

  const refreshElevenVoices = useCallback(async () => {
    if (!elevenProxyUrl && elevenUseServerKey) {
      setElevenVoicesError(
        "Voice browsing in server mode needs VITE_TTS_PROXY_URL.",
      );
      setElevenVoices([]);
      return;
    }
    if (!elevenUseServerKey && !elevenApiKey.trim()) {
      setElevenVoicesError("Add your ElevenLabs key to browse voices.");
      setElevenVoices([]);
      return;
    }
    setLoadingElevenVoices(true);
    setElevenVoicesError(null);
    try {
      const voices = await fetchElevenLabsVoices({
        proxyUrl: elevenProxyUrl ?? undefined,
        apiKey: elevenUseServerKey ? undefined : elevenApiKey.trim() || undefined,
      });
      setElevenVoices(voices);
      if (forcedVoiceId) {
        setElevenVoiceId(forcedVoiceId);
      } else if (
        voices.length > 0 &&
        !voices.some((v) => v.voice_id === elevenVoiceId.trim())
      ) {
        setElevenVoiceId(voices[0]!.voice_id);
      }
    } catch (e) {
      setElevenVoicesError(e instanceof Error ? e.message : String(e));
      setElevenVoices([]);
    } finally {
      setLoadingElevenVoices(false);
    }
  }, [elevenApiKey, elevenProxyUrl, elevenUseServerKey, elevenVoiceId, forcedVoiceId]);

  const setVoiceIdFromUser = useCallback(
    (voiceId: string) => {
      if (forcedVoiceId) {
        setElevenVoiceId(forcedVoiceId);
        setChatError(`Voice is locked for token #${loadedId}: ${forcedVoiceId}`);
        return;
      }
      setElevenVoiceId(voiceId);
      if (loadedId === null) return;
      try {
        const trimmed = voiceId.trim();
        if (!trimmed) return;
        localStorage.setItem(voiceTokenKey(loadedId), trimmed);
        const wallet = normalizeWalletAddress(walletInput);
        if (wallet) {
          localStorage.setItem(voiceKey(wallet, loadedId), trimmed);
        }
      } catch {
        /* ignore */
      }
    },
    [forcedVoiceId, loadedId, walletInput],
  );

  const speakReply = useCallback(
    async (text: string, index: number): Promise<boolean> => {
      const ttsText =
        loadedId === SERC_TOKEN_ID ? stripUrlsForSpeech(text).trim() : text.trim();
      if (!ttsText) return false;
      if (!elevenProxyUrl && elevenUseServerKey) {
        setChatError(
          "Generic server voice requires VITE_TTS_PROXY_URL (ElevenLabs proxy).",
        );
        return false;
      }
      if (!elevenProxyUrl && !elevenUseServerKey && !elevenApiKey.trim()) {
        setChatError(
          "Add your ElevenLabs API key, or switch to Generic server voice with a proxy URL.",
        );
        return false;
      }
      try {
        setChatError(null);
        setSpeakingIndex(index);
        setMouthLevel(0);
        mouthSmoothedRef.current = 0;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        const blob = await synthesizeElevenLabsSpeech({
          proxyUrl: elevenProxyUrl ?? undefined,
          text: ttsText,
          voiceId: elevenVoiceId,
          modelId: elevenModelId,
          voiceSettings: autoVoiceDynamics ? dynamicVoice.settings : undefined,
          apiKey: elevenUseServerKey ? undefined : elevenApiKey.trim() || undefined,
        });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const audioCtx = audioCtxRef.current ?? new AudioContext();
        audioCtxRef.current = audioCtx;
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        if (sourceRef.current) {
          sourceRef.current.disconnect();
          sourceRef.current = null;
        }
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.82;
        const source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyserRef.current = analyser;
        sourceRef.current = source;
        const bytes = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(bytes);
          let sum = 0;
          for (let i = 0; i < bytes.length; i++) {
            const n = (bytes[i] - 128) / 128;
            sum += n * n;
          }
          const rms = Math.sqrt(sum / bytes.length);
          // Noise gate + curved ramp:
          // - quiet speech/excitement => barely any mouth motion
          // - stronger speech => visibly wider opens
          const gate = 0.016;
          const span = 0.1;
          const normalized = Math.max(0, Math.min(1, (rms - gate) / span));
          const curved = Math.pow(normalized, 1.5);
          const target = Math.min(1, curved * 1.12);
          // Asymmetric smoothing: quick attack, slow release = smoother lip sync, less flicker
          let s = mouthSmoothedRef.current;
          const up = 0.42;
          const down = 0.16;
          s += (target - s) * (target > s ? up : down);
          mouthSmoothedRef.current = s;
          setMouthLevel(s);
          if (audioRef.current === audio && !audio.paused && !audio.ended) {
            rafRef.current = requestAnimationFrame(tick);
          }
        };
        rafRef.current = requestAnimationFrame(tick);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          mouthSmoothedRef.current = 0;
          setMouthLevel(0);
          source.disconnect();
          if (audioRef.current === audio) audioRef.current = null;
          setSpeakingIndex(null);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          mouthSmoothedRef.current = 0;
          setMouthLevel(0);
          source.disconnect();
          if (audioRef.current === audio) audioRef.current = null;
          setSpeakingIndex(null);
          setChatError("Unable to play ElevenLabs audio.");
        };
        await audio.play();
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          audio.addEventListener("ended", done, { once: true });
          audio.addEventListener("error", done, { once: true });
        });
        return true;
      } catch (e) {
        setSpeakingIndex(null);
        mouthSmoothedRef.current = 0;
        setMouthLevel(0);
        setChatError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [
      autoVoiceDynamics,
      dynamicVoice.settings,
      elevenApiKey,
      elevenModelId,
      elevenProxyUrl,
      elevenUseServerKey,
      elevenVoiceId,
      loadedId,
      speakingIndex,
    ],
  );

  useEffect(() => {
    void refreshElevenVoices();
  }, [refreshElevenVoices]);

  useEffect(() => {
    if (!isVamping) return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        const ok = await speakReply(vampText, -1);
        if (!ok || cancelled) break;
        await sleepMs(120);
      }
      if (!cancelled) setIsVamping(false);
    };
    void loop();
    return () => {
      cancelled = true;
    };
  }, [isVamping, speakReply, vampText]);

  const loadNormieForId = useCallback(async (id: number) => {
    if (!validTokenId(id)) {
      setLoadError("Enter a Normie token id from 0–9999.");
      return;
    }
    setLoadError(null);
    setLoadingTraits(true);
    try {
      const { attributes } = await fetchNormieTraits(id);
      const eyesTrait = attributes.find(
        (a) => a.trait_type.toLowerCase() === "eyes",
      );
      const genderTrait = attributes.find(
        (a) => a.trait_type.toLowerCase() === "gender",
      );
      const ageTrait = attributes.find((a) => a.trait_type.toLowerCase() === "age");
      setHasEyewear(
        !!eyesTrait &&
          traitIndicatesEyewear(String(eyesTrait.value)),
      );
      setNormieGender(genderTrait ? String(genderTrait.value) : null);
      setNormieAge(ageTrait ? String(ageTrait.value) : null);
      const wallet = normalizeWalletAddress(walletInput);
      const forcedVoice = forcedVoiceForToken(id);
      if (forcedVoice) {
        setElevenVoiceId(forcedVoice);
      } else {
        try {
          const cachedVoice =
            (wallet && localStorage.getItem(voiceKey(wallet, id))) ||
            localStorage.getItem(voiceTokenKey(id));
          if (cachedVoice && cachedVoice.trim()) {
            setElevenVoiceId(cachedVoice.trim());
          } else if (autoVoiceByGender && genderTrait) {
            const g = String(genderTrait.value).toLowerCase();
            if (g.includes("female")) setElevenVoiceId(ELEVEN_FEMALE_VOICE_ID);
            else if (g.includes("male")) setElevenVoiceId(ELEVEN_MALE_VOICE_ID);
          }
        } catch {
          if (autoVoiceByGender && genderTrait) {
            const g = String(genderTrait.value).toLowerCase();
            if (g.includes("female")) setElevenVoiceId(ELEVEN_FEMALE_VOICE_ID);
            else if (g.includes("male")) setElevenVoiceId(ELEVEN_MALE_VOICE_ID);
          }
        }
      }
      try {
        const raw =
          (wallet && localStorage.getItem(mouthLookKey(wallet, id))) ||
          localStorage.getItem(mouthLookTokenKey(id));
        if (raw) {
          const s = JSON.parse(raw) as {
            x?: number;
            y?: number;
            w?: number;
            h?: number;
            lineH?: number;
          };
          if (Number.isFinite(s.x)) setMouthX(s.x as number);
          if (Number.isFinite(s.y)) setMouthY(s.y as number);
          if (Number.isFinite(s.w)) setMouthW(s.w as number);
          if (Number.isFinite(s.h)) setMouthH(s.h as number);
          if (Number.isFinite(s.lineH)) setMouthLineH(s.lineH as number);
        }
      } catch {
        /* ignore */
      }
      const basePrompt = buildNormieSystemPrompt(id, attributes);
      const sercPrompt =
        id === SERC_TOKEN_ID
          ? `${basePrompt}

SERC identity mode (token ${SERC_TOKEN_ID}):
- Your canonical name is SERC.
- Speak in first person at all times (I/me/my). Never refer to yourself as a third-party character.
- If you mention "SERC" in conversation, explicitly clarify: "that's me."
- Reinforce these message pillars consistently in tone and substance:
${SERC_MESSAGE_PILLARS.map((line) => `  - "${line}"`).join("\n")}
- Keep replies concise, confident, builder-first, and execution-oriented.`
          : basePrompt;
      setSystemPrompt(sercPrompt);
      setLoadedId(id);
      if (id === SERC_TOKEN_ID && elevenProxyUrl) {
        setElevenUseServerKey(true);
      }
      if (id === SERC_TOKEN_ID) {
        sercSessionIdRef.current = makeSessionId("serc");
      }
      if (autoNormieBackground) {
        const seed = attributes
          .slice(0, 4)
          .map((a) => `${a.trait_type}:${String(a.value)}`)
          .join("|");
        remixBackground(`${id}|${seed}`);
      }
      setTokenInput(String(id));
      setMessages([]);
      setIsVamping(false);
      setChatError(null);
    } catch (e) {
      setHasEyewear(false);
      setNormieGender(null);
      setNormieAge(null);
      setSystemPrompt(null);
      setLoadedId(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTraits(false);
    }
  }, [
    autoNormieBackground,
    autoVoiceByGender,
    remixBackground,
    walletInput,
    elevenProxyUrl,
  ]);

  const loadNormie = useCallback(() => {
    void loadNormieForId(Number.parseInt(tokenInput.trim(), 10));
  }, [loadNormieForId, tokenInput]);

  const fetchHolders = useCallback(async () => {
    setHolderError(null);
    setLoadingHolders(true);
    try {
      const { tokenIds } = await fetchHolderTokenIds(walletInput);
      const nums = tokenIds
        .map((t) => Number.parseInt(t, 10))
        .filter((n) => validTokenId(n));
      nums.sort((a, b) => a - b);
      setHolderIds(nums);
      if (nums.length === 0) {
        setHolderError(
          "No Normies at this address right now (burned or empty wallet).",
        );
      }
    } catch (e) {
      setHolderIds([]);
      setHolderError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHolders(false);
    }
  }, [walletInput]);

  const send = useCallback(async () => {
    const activeEndpoint =
      loadedId === SERC_TOKEN_ID ? sercKnowledgeEndpoint : endpoint;
    if (!activeEndpoint) {
      setChatError(
        "No chat endpoint. For production builds set VITE_CHAT_COMPLETIONS_URL to your backend.",
      );
      return;
    }
    if (!systemPrompt || loadedId === null) {
      setChatError("Load your Normie first.");
      return;
    }
    const text = draft.trim();
    if (!text || sending) return;

    setChatError(null);
    setSending(true);
    const nextUser: ChatMessage = { role: "user", content: text };
    setMessages((m) => [...m, nextUser]);
    setDraft("");

    const body: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
      nextUser,
    ];

    try {
      let reply = await sendChatCompletion({
        endpoint: activeEndpoint,
        model,
        messages: body,
        apiKey: usesProxy ? undefined : apiKey.trim() || undefined,
        sessionId:
          loadedId === SERC_TOKEN_ID ? sercSessionIdRef.current : undefined,
      });
      // If SERC knowledge endpoint gets stuck in a canned loop, fail over once.
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")?.content
        ?.trim();
      const looksCannedSercReply = /prompt is stored on-chain/i.test(reply);
      const repeatedReply = !!lastAssistant && reply.trim() === lastAssistant;
      if (
        loadedId === SERC_TOKEN_ID &&
        endpoint &&
        endpoint !== activeEndpoint &&
        (looksCannedSercReply || repeatedReply)
      ) {
        reply = await sendChatCompletion({
          endpoint,
          model,
          messages: body,
          apiKey: usesProxy ? undefined : apiKey.trim() || undefined,
        });
      }
      if (loadedId === SERC_TOKEN_ID) {
        reply = normalizeSercReply(reply);
      }
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (autoNormieBackground) remixBackground(reply);
      if (overlayAuto) {
        setOverlayKind(replyOverlayKind(reply));
        setOverlaySeedText(reply);
      }
      void speakReply(reply, messages.length + 1);
    } catch (e) {
      setMessages((m) => m.slice(0, -1));
      setDraft(text);
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [
    apiKey,
    draft,
    endpoint,
    sercKnowledgeEndpoint,
    loadedId,
    messages,
    model,
    remixBackground,
    speakReply,
    sending,
    systemPrompt,
    autoNormieBackground,
    overlayAuto,
    usesProxy,
  ]);

  return (
    <div className="layout normie-agent-layout">
      <section
        className="normie-agent__workspace"
        aria-label="Normie workspace"
      >
        <section
          className="panel normie-agent__chat normie-agent__chat--focus"
          aria-label="Chat with Normie"
        >
          <div className="normie-agent__chat-head">
            <h2 className="normie-agent__h2">Chat</h2>
            <div className="normie-agent__chat-actions">
              <button
                type="button"
                className="normie-agent__btn normie-agent__btn--small"
                onClick={() => setSettingsOpen(true)}
              >
                Paste keys / Settings
              </button>
              <button
                type="button"
                className="normie-agent__btn normie-agent__btn--small"
                onClick={() => setNormiePoppedOut(true)}
              >
                Pop out Normie
              </button>
            </div>
          </div>
          {!loadedId ? (
            <p className="normie-agent__hint">Load a Normie to start.</p>
          ) : (
            <p className="normie-agent__hint normie-agent__hint--tight">
              Each reply remembers this session — keep sending to go back and
              forth. Enter sends; Shift+Enter newline.
            </p>
          )}
          <div className="normie-agent__messages" aria-live="polite">
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={
                  m.role === "user"
                    ? "normie-agent__bubble normie-agent__bubble--user"
                    : "normie-agent__bubble normie-agent__bubble--assistant"
                }
              >
                <div className="normie-agent__bubble-head">
                  <span className="normie-agent__bubble-role">
                    {m.role === "user" ? "You" : `Normie #${loadedId}`}
                  </span>
                  {m.role === "assistant" ? (
                    <button
                      type="button"
                      className="normie-agent__bubble-speak"
                      onClick={() => void speakReply(m.content, i)}
                      title={
                        elevenProxyUrl
                          ? elevenUseServerKey
                            ? "Read aloud with ElevenLabs (generic server voice)"
                            : "Read aloud with ElevenLabs (your key)"
                          : "Read aloud with ElevenLabs (your key)"
                      }
                      disabled={speakingIndex !== null}
                    >
                      {speakingIndex === i ? "Playing..." : "Read"}
                    </button>
                  ) : null}
                </div>
                <p className="normie-agent__bubble-text">{renderChatContent(m.content)}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {chatError ? (
            <p className="normie-agent__err" role="alert">
              {chatError}
            </p>
          ) : null}
          <div className="normie-agent__compose">
            <textarea
              className="normie-agent__textarea"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                loadedId
                  ? "Type or use Mic — Enter to send"
                  : "Load a Normie first…"
              }
              disabled={!loadedId || sending || !endpoint}
            />
            <div className="normie-agent__compose-actions">
              {recCtor ? (
                <button
                  type="button"
                  className="normie-agent__btn"
                  onClick={startListening}
                  disabled={!loadedId || sending || !endpoint || listening}
                  title="Browser speech-to-text (Chrome / Edge work best)"
                >
                  {listening ? "Listening…" : "Mic"}
                </button>
              ) : null}
              <button
                type="button"
                className="normie-agent__btn normie-agent__btn--send"
                onClick={() => void send()}
                disabled={
                  !loadedId || sending || !draft.trim() || !endpoint || !systemPrompt
                }
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </div>
        </section>
        <section className="panel normie-agent__agent-pane" aria-label="Normie stage">
          <div className="normie-agent__intro">
            <h1 className="title">TALK WITH SERC, or your Normie too!!!</h1>
          </div>
          <div className="normie-agent__row normie-agent__row--inline-load">
            <label className="normie-agent__label">
              Token id
              <input
                className="normie-agent__input"
                type="number"
                min={0}
                max={9999}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="normie-agent__btn"
              onClick={loadNormie}
              disabled={loadingTraits}
            >
              {loadingTraits ? "Loading..." : "Load"}
            </button>
            <button
              type="button"
              className="normie-agent__btn normie-agent__btn--small"
              onClick={() => void loadNormieForId(SERC_TOKEN_ID)}
              disabled={loadingTraits}
              title="Instantly load SERC (token 4354)"
            >
              Talk to SERC
            </button>
          </div>
          {loadError ? (
            <p className="normie-agent__err" role="alert">
              {loadError}
            </p>
          ) : null}
          <div
            className={
              speakingIndex !== null
                ? "normie-agent-avatar normie-agent-avatar--speaking"
                : "normie-agent-avatar"
            }
            style={
              {
                "--mouth-open": String(mouthLevel),
                "--mouth-x": `${mouthX}%`,
                "--mouth-y": `${mouthY}%`,
                "--mouth-w": `${mouthW}%`,
                "--mouth-h": String(mouthH),
                "--mouth-line-h": `${mouthLineH}px`,
              } as CSSProperties
            }
          >
            <div className="normie-agent-avatar__image-wrap">
              <div
                className="normie-agent-avatar__bg"
                style={{ backgroundImage: generatedBackground.image }}
                aria-hidden="true"
              />
              {show3D ? (
                <Normie3DViewer
                  className="normie-agent-avatar__viewer"
                  loadParams={agent3DLoadParams}
                  layout="inline"
                  showExportButton={false}
                  showSceneControls={false}
                />
              ) : (
                <>
                  <canvas
                    ref={overlayCanvasMainRef}
                    className="normie-agent-avatar__scribble"
                    width={80}
                    height={80}
                    aria-hidden="true"
                  />
                  <NormiesHeaderArt tokenId={loadedId} />
                  <div
                    className={
                      hasEyewear && !forceEyes
                        ? "normie-agent-avatar__eyes normie-agent-avatar__eyes--hidden"
                        : "normie-agent-avatar__eyes"
                    }
                    aria-hidden="true"
                  >
                    <span className="normie-agent-avatar__eye normie-agent-avatar__eye--l" />
                    <span className="normie-agent-avatar__eye normie-agent-avatar__eye--r" />
                  </div>
                  <div className="normie-agent-avatar__mouth" aria-hidden="true">
                    <span className="normie-agent-avatar__line normie-agent-avatar__line--a" />
                    <span className="normie-agent-avatar__line normie-agent-avatar__line--b" />
                    <span className="normie-agent-avatar__line normie-agent-avatar__line--c" />
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="normie-agent-avatar__tune-toggle"
              onClick={() => setShowMouthPicker((v) => !v)}
            >
              {showMouthPicker ? "Hide tuning" : "Tune face"}
            </button>
            {showMouthPicker ? (
              <div className="normie-agent-avatar__panel-row">
                <div className="normie-agent-avatar__panel-head">
                  <span className="normie-agent-avatar__panel-head-title">
                    Face tuning
                  </span>
                  <button
                    type="button"
                    className="normie-agent__btn normie-agent__btn--small"
                    onClick={() => setShowMouthPicker(false)}
                    aria-label="Close face tuning"
                  >
                    Done
                  </button>
                </div>
                <aside className="normie-agent-avatar__panel normie-agent-avatar__panel--left">
                  <p className="normie-agent-avatar__panel-title">Placement</p>
                  <label className="normie-agent__label">
                    Mouth X: {mouthX.toFixed(1)}%
                    <input
                      className="normie-agent__range"
                      type="range"
                      min={20}
                      max={80}
                      step={0.5}
                      value={mouthX}
                      onChange={(e) => setMouthX(Number.parseFloat(e.target.value))}
                    />
                  </label>
                  <label className="normie-agent__label">
                    Mouth Y: {mouthY.toFixed(1)}%
                    <input
                      className="normie-agent__range"
                      type="range"
                      min={45}
                      max={70}
                      step={0.5}
                      value={mouthY}
                      onChange={(e) => setMouthY(Number.parseFloat(e.target.value))}
                    />
                  </label>
                </aside>
                <aside className="normie-agent-avatar__panel normie-agent-avatar__panel--right">
                  <p className="normie-agent-avatar__panel-title">Motion</p>
                  <label className="normie-agent__label">
                    Mouth width: {mouthW.toFixed(1)}%
                    <input
                      className="normie-agent__range"
                      type="range"
                      min={6}
                      max={20}
                      step={0.5}
                      value={mouthW}
                      onChange={(e) => setMouthW(Number.parseFloat(e.target.value))}
                    />
                  </label>
                  <label className="normie-agent__label">
                    Mouth open: {mouthH.toFixed(2)}x
                    <input
                      className="normie-agent__range"
                      type="range"
                      min={0.8}
                      max={6}
                      step={0.1}
                      value={mouthH}
                      onChange={(e) => setMouthH(Number.parseFloat(e.target.value))}
                    />
                  </label>
                  <label className="normie-agent__label">
                    Mouth height: {mouthLineH.toFixed(1)}px
                    <input
                      className="normie-agent__range"
                      type="range"
                      min={1}
                      max={8}
                      step={0.5}
                      value={mouthLineH}
                      onChange={(e) =>
                        setMouthLineH(Number.parseFloat(e.target.value))
                      }
                    />
                  </label>
                  <label className="normie-agent__toggle">
                    <input
                      type="checkbox"
                      checked={forceEyes}
                      onChange={(e) => setForceEyes(e.target.checked)}
                    />{" "}
                    Force eyes (debug)
                  </label>
                  <p className="normie-agent__hint normie-agent__hint--tight">
                    Eyes:{" "}
                    <strong>
                      {hasEyewear && !forceEyes ? "off (eyewear)" : "on"}
                    </strong>
                  </p>
                </aside>
              </div>
            ) : (
              <div className="normie-agent-avatar__panel-spacer" aria-hidden="true" />
            )}
          </div>
        </section>
      </section>

      {normiePoppedOut ? (
        <section className="normie-agent-pop" aria-label="Popped out Normie window">
          <button
            type="button"
            className="normie-agent-pop__close"
            onClick={() => setNormiePoppedOut(false)}
          >
            Close
          </button>
          <div className="normie-agent-pop__stage">
            <div
              className={
                speakingIndex !== null
                  ? "normie-agent-avatar normie-agent-avatar--pop normie-agent-avatar--speaking"
                  : "normie-agent-avatar normie-agent-avatar--pop"
              }
              style={
                {
                  "--mouth-open": String(mouthLevel),
                  "--mouth-x": `${mouthX}%`,
                  "--mouth-y": `${mouthY}%`,
                  "--mouth-w": `${mouthW}%`,
                  "--mouth-h": String(mouthH),
                  "--mouth-line-h": `${mouthLineH}px`,
                } as CSSProperties
              }
            >
              <div className="normie-agent-avatar__image-wrap">
                <div
                  className="normie-agent-avatar__bg"
                  style={{ backgroundImage: generatedBackground.image }}
                  aria-hidden="true"
                />
                {!show3D ? (
                  <>
                    <canvas
                      ref={overlayCanvasPopRef}
                      className="normie-agent-avatar__scribble"
                      width={80}
                      height={80}
                      aria-hidden="true"
                    />
                    <div className="normie-agent-avatar__scribble-badge">
                      Scribble: {overlayKind}
                    </div>
                  </>
                ) : null}
                {show3D ? (
                  <Normie3DViewer
                    className="normie-agent-avatar__viewer"
                    loadParams={agent3DLoadParams}
                    layout="inline"
                    showExportButton={false}
                    showSceneControls={false}
                  />
                ) : (
                  <>
                    <NormiesHeaderArt tokenId={loadedId} />
                    <div
                      className={
                        hasEyewear && !forceEyes
                          ? "normie-agent-avatar__eyes normie-agent-avatar__eyes--hidden"
                          : "normie-agent-avatar__eyes"
                      }
                      aria-hidden="true"
                    >
                      <span className="normie-agent-avatar__eye normie-agent-avatar__eye--l" />
                      <span className="normie-agent-avatar__eye normie-agent-avatar__eye--r" />
                    </div>
                    <div
                      className="normie-agent-avatar__mouth"
                      aria-hidden="true"
                    >
                      <span className="normie-agent-avatar__line normie-agent-avatar__line--a" />
                      <span className="normie-agent-avatar__line normie-agent-avatar__line--b" />
                      <span className="normie-agent-avatar__line normie-agent-avatar__line--c" />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="normie-agent-pop__chat">
            <div className="normie-agent__messages normie-agent__messages--mini" aria-live="polite">
              {messages.map((m, i) => (
                <div
                  key={`pop-${m.role}-${i}`}
                  className={
                    m.role === "user"
                      ? "normie-agent__bubble normie-agent__bubble--user"
                      : "normie-agent__bubble normie-agent__bubble--assistant"
                  }
                >
                  <span className="normie-agent__bubble-role">
                    {m.role === "user" ? "You" : `Normie #${loadedId}`}
                  </span>
                  <p className="normie-agent__bubble-text">{renderChatContent(m.content)}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="normie-agent__compose">
              <textarea
                className="normie-agent__textarea"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  loadedId
                    ? "Type or use Mic — Enter to send"
                    : "Load a Normie first…"
                }
                disabled={!loadedId || sending || !endpoint}
              />
              <div className="normie-agent__compose-actions">
                {recCtor ? (
                  <button
                    type="button"
                    className="normie-agent__btn"
                    onClick={startListening}
                    disabled={!loadedId || sending || !endpoint || listening}
                    title="Browser speech-to-text (Chrome / Edge work best)"
                  >
                    {listening ? "Listening…" : "Mic"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="normie-agent__btn normie-agent__btn--send"
                  onClick={() => void send()}
                  disabled={
                    !loadedId || sending || !draft.trim() || !endpoint || !systemPrompt
                  }
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <SiteNav />

      {!endpoint ? (
        <section className="panel normie-agent__warn" role="status">
          <p className="normie-agent__warn-p">
            Static hosting has no OpenAI proxy. Set{" "}
            <code className="normie-agent__code">VITE_CHAT_COMPLETIONS_URL</code>{" "}
            to your serverless URL (must allow browser CORS and forward to an
            LLM).
          </p>
        </section>
      ) : null}

      {settingsOpen ? (
      <section className="normie-agent-settings-pop" aria-label="Normie settings">
        <div className="panel normie-agent__setup" aria-label="Load Normie">
        <div className="normie-agent-settings-pop__head">
        <h2 className="normie-agent__h2">Settings</h2>
        <button
          type="button"
          className="normie-agent__btn normie-agent__btn--small"
          onClick={() => setSettingsOpen(false)}
        >
          Close
        </button>
        </div>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Testing mode: paste your keys here (session-only in this browser, not
          committed to code).
        </p>

        <h3 className="normie-agent__h3">From wallet (indexed holdings)</h3>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Same data as reading <code className="normie-agent__code">Transfer</code>{" "}
          logs into an indexer — faster than walking txs in the browser. Paste any
          address; connect-wallet proof is a separate step.
        </p>
        <div className="normie-agent__row">
          <label className="normie-agent__label normie-agent__label--grow">
            Wallet
            <input
              className="normie-agent__input normie-agent__input--wide"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="normie-agent__btn"
            onClick={() => void fetchHolders()}
            disabled={loadingHolders}
          >
            {loadingHolders ? "…" : "List ids"}
          </button>
        </div>
        {holderError ? (
          <p className="normie-agent__err" role="alert">
            {holderError}
          </p>
        ) : null}
        {holderIds.length > 0 ? (
          <div className="normie-agent__chips" role="list">
            {holderIds.map((id) => (
              <button
                key={id}
                type="button"
                role="listitem"
                className={
                  loadedId === id
                    ? "normie-agent__chip normie-agent__chip--active"
                    : "normie-agent__chip"
                }
                onClick={() => void loadNormieForId(id)}
                disabled={loadingTraits}
              >
                #{id}
              </button>
            ))}
          </div>
        ) : null}

        <p className="normie-agent__hint normie-agent__hint--tight">
          Face tuning pops around the avatar (Tune face). Wallet + token keeps that look.
        </p>

        <div className="normie-agent__row normie-agent__row--model">
          <label className="normie-agent__label">
            Model
            <input
              className="normie-agent__input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>

        <h3 className="normie-agent__h3">Voice (ElevenLabs)</h3>
        <p className="normie-agent__hint normie-agent__hint--tight">
          {elevenProxyUrl
            ? "Read uses your ElevenLabs proxy endpoint. Optional user key can override generic server auth."
            : "No ElevenLabs proxy configured. Generic mode needs VITE_TTS_PROXY_URL; My key mode calls ElevenLabs directly from the browser."}
        </p>
        <div className="normie-agent__chips" role="tablist" aria-label="ElevenLabs auth mode">
          <button
            type="button"
            role="tab"
            aria-selected={elevenUseServerKey}
            className={
              elevenUseServerKey
                ? "normie-agent__chip normie-agent__chip--active"
                : "normie-agent__chip"
            }
            onClick={() => setElevenUseServerKey(true)}
          >
            Generic server voice
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!elevenUseServerKey}
            className={
              !elevenUseServerKey
                ? "normie-agent__chip normie-agent__chip--active"
                : "normie-agent__chip"
            }
            onClick={() => setElevenUseServerKey(false)}
          >
            My ElevenLabs key
          </button>
        </div>
        <div className="normie-agent__row">
          <label className="normie-agent__label">
            Voice
            <select
              className="normie-agent__input"
              value={elevenVoiceId}
              onChange={(e) => setVoiceIdFromUser(e.target.value)}
              disabled={!!forcedVoiceId || loadingElevenVoices || elevenVoices.length === 0}
            >
              {elevenVoices.length === 0 ? (
                <option value={elevenVoiceId}>
                  {loadingElevenVoices ? "Loading voices…" : "No voices loaded"}
                </option>
              ) : (
                elevenVoices.map((voice) => (
                  <option key={voice.voice_id} value={voice.voice_id}>
                    {voice.name}
                    {voice.category ? ` (${voice.category})` : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            className="normie-agent__btn normie-agent__btn--small"
            onClick={() => void refreshElevenVoices()}
            disabled={loadingElevenVoices}
          >
            {loadingElevenVoices ? "…" : "Refresh voices"}
          </button>
        </div>
        <div className="normie-agent__row">
          <label className="normie-agent__label">
            Voice ID
            <input
              className="normie-agent__input"
              value={elevenVoiceId}
              onChange={(e) => setVoiceIdFromUser(e.target.value)}
              placeholder="EXAVITQu4vr4xnSDxMaL"
              disabled={!!forcedVoiceId}
            />
          </label>
          <label className="normie-agent__label">
            Model ID
            <input
              className="normie-agent__input"
              value={elevenModelId}
              onChange={(e) => setElevenModelId(e.target.value)}
              placeholder="eleven_turbo_v2_5"
            />
          </label>
        </div>
        {elevenVoicesError ? (
          <p className="normie-agent__err" role="alert">
            {elevenVoicesError}
          </p>
        ) : null}
        {forcedVoiceId ? (
          <p className="normie-agent__hint normie-agent__hint--tight">
            Voice locked for token #{loadedId}:{" "}
            <code className="normie-agent__code">{forcedVoiceId}</code>
          </p>
        ) : null}
        <label className="normie-agent__toggle">
          <input
            type="checkbox"
            checked={autoVoiceByGender}
            onChange={(e) => setAutoVoiceByGender(e.target.checked)}
          />{" "}
          Auto voice by Normie gender trait
        </label>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Male defaults to <code className="normie-agent__code">{ELEVEN_MALE_VOICE_ID}</code>, female to{" "}
          <code className="normie-agent__code">{ELEVEN_FEMALE_VOICE_ID}</code>.
        </p>
        <label className="normie-agent__toggle">
          <input
            type="checkbox"
            checked={autoVoiceDynamics}
            onChange={(e) => setAutoVoiceDynamics(e.target.checked)}
          />{" "}
          Auto voice dynamics by age/gender traits
        </label>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Current profile: <strong>{dynamicVoice.label}</strong>
        </p>
        {!elevenUseServerKey ? (
          <label className="normie-agent__label normie-agent__label--block">
            ElevenLabs API key (session only)
            <input
              className="normie-agent__input normie-agent__input--wide"
              type="password"
              autoComplete="off"
              value={elevenApiKey}
              onChange={(e) => persistElevenApiKey(e.target.value)}
              placeholder="sk_..."
            />
          </label>
        ) : (
          <p className="normie-agent__hint">
            Using your proxy&apos;s server key. Switch to &quot;My ElevenLabs key&quot; to
            send your own key for this session.
          </p>
        )}
        <h3 className="normie-agent__h3">Audio vamp mode</h3>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Loops a short spoken line so you can tune mouth/eye position and scale.
        </p>
        <label className="normie-agent__label normie-agent__label--block">
          Vamp line
          <input
            className="normie-agent__input normie-agent__input--wide"
            value={vampText}
            onChange={(e) => setVampText(e.target.value)}
            placeholder="La la la..."
          />
        </label>
        <button
          type="button"
          className="normie-agent__btn"
          onClick={() => setIsVamping((v) => !v)}
          disabled={speakingIndex !== null && !isVamping}
        >
          {isVamping ? "Stop vamp" : "Start vamp"}
        </button>
        <h3 className="normie-agent__h3">Visual mode</h3>
        <div className="normie-agent__chips" role="tablist" aria-label="2D or 3D mode">
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={visualMode === m}
              className={
                visualMode === m
                  ? "normie-agent__chip normie-agent__chip--active"
                  : "normie-agent__chip"
              }
              onClick={() => {
                if (m === "2d") setVisualMode("2d");
              }}
              disabled={m === "3d"}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Active view: <strong>2D</strong> (3D temporarily disabled)
        </p>
        <h3 className="normie-agent__h3">Normie-generated background</h3>
        <label className="normie-agent__toggle">
          <input
            type="checkbox"
            checked={autoNormieBackground}
            onChange={(e) => setAutoNormieBackground(e.target.checked)}
          />{" "}
          Auto-generate background from Normie replies
        </label>
        <button
          type="button"
          className="normie-agent__btn"
          onClick={() =>
            remixBackground(
              `${draft || "remix"}|${messages.length}|${generatedBackground.label}`,
            )
          }
        >
          Remix background
        </button>
        <h3 className="normie-agent__h3">Pixel scribble overlay</h3>
        <label className="normie-agent__toggle">
          <input
            type="checkbox"
            checked={overlayAuto}
            onChange={(e) => setOverlayAuto(e.target.checked)}
          />{" "}
          Agent scribbles emotes/math from conversation
        </label>
        <button
          type="button"
          className="normie-agent__btn"
          onClick={() => {
            setVisualMode("2d");
            setOverlayKind("energy");
            setOverlaySeedText(
              `${Date.now()}|${loadedId ?? "none"}|${messages.length}`,
            );
          }}
        >
          Trigger scribble
        </button>
        <p className="normie-agent__hint normie-agent__hint--tight">
          Scribbles currently render in 2D mode (trigger switches to 2D automatically).{" "}
          <Link to="/gif" className="site-nav__link" style={{ fontWeight: 500 }}>
            Short MP4 / GIF loops for X
          </Link>
        </p>

        {usesProxy && ollamaDev ? (
          <p className="normie-agent__hint">
            Local LLM: install{" "}
            <a
              href="https://ollama.com/"
              target="_blank"
              rel="noreferrer"
            >
              Ollama
            </a>
            , run <code className="normie-agent__code">ollama serve</code>,{" "}
            <code className="normie-agent__code">ollama pull &lt;model&gt;</code>{" "}
            (model name must match the field above). Optional:{" "}
            <code className="normie-agent__code">OLLAMA_HOST</code> in{" "}
            <code className="normie-agent__code">.env.local</code> if not on{" "}
            <code className="normie-agent__code">127.0.0.1:11434</code>.
          </p>
        ) : usesProxy ? (
          <p className="normie-agent__hint">
            Dev proxy active: put{" "}
            <code className="normie-agent__code">OPENAI_API_KEY</code> in{" "}
            <code className="normie-agent__code">.env.local</code> (not{" "}
            <code className="normie-agent__code">VITE_*</code>) and restart{" "}
            <code className="normie-agent__code">npm run dev</code>.
          </p>
        ) : (
          <>
            <label className="normie-agent__label normie-agent__label--block">
              API key (session only)
              <input
                className="normie-agent__input"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => persistKey(e.target.value)}
                placeholder="sk-…"
              />
            </label>
            <p className="normie-agent__hint">
              Optional: use if your{" "}
              <code className="normie-agent__code">
                VITE_CHAT_COMPLETIONS_URL
              </code>{" "}
              expects a Bearer token from the browser; leave blank if the
              server adds auth.
            </p>
          </>
        )}
        </div>
      </section>
      ) : null}

    </div>
  );
}
