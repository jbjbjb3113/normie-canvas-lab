const DEFAULT_BASE = "https://api.normies.art";

export function getApiBase(): string {
  const fromEnv = import.meta.env.VITE_NORMIES_API_BASE;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/normies-api";
  return DEFAULT_BASE;
}

export type CanvasDiff = {
  added: { x: number; y: number }[];
  removed: { x: number; y: number }[];
  addedCount: number;
  removedCount: number;
  netChange: number;
};

export type CanvasInfo = {
  actionPoints: number;
  level: number;
  customized: boolean;
  delegate: string;
  delegateSetBy: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCanvasDiff(
  id: number,
  signal?: AbortSignal,
): Promise<CanvasDiff> {
  const base = getApiBase();
  const res = await fetch(`${base}/normie/${id}/canvas/diff`, {
    signal,
    headers: { Accept: "application/json" },
  });
  return parseJson<CanvasDiff>(res);
}

export async function fetchCanvasInfo(
  id: number,
  signal?: AbortSignal,
): Promise<CanvasInfo> {
  const base = getApiBase();
  const res = await fetch(`${base}/normie/${id}/canvas/info`, {
    signal,
    headers: { Accept: "application/json" },
  });
  return parseJson<CanvasInfo>(res);
}

export function imageOriginalPngUrl(id: number): string {
  return `${getApiBase()}/normie/${id}/original/image.png`;
}

export function imageCurrentPngUrl(id: number): string {
  return `${getApiBase()}/normie/${id}/image.png`;
}
