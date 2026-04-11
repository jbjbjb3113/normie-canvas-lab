/**
 * Dev: Vite proxy at /normies-api → api.normies.art
 * Prod: call Normies API directly (browser CORS must allow your host; api.normies.art does for GET).
 * Override: VITE_NORMIES_API_BASE=https://example.com/proxy (no trailing slash)
 */
export function getApiBase(): string {
  const fromEnv = import.meta.env.VITE_NORMIES_API_BASE;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/normies-api";
  return "https://api.normies.art";
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

/** Burn commitment (list or detail). Fields mirror api.normies.art history endpoints. */
export type BurnCommitmentSummary = {
  commitId: string;
  owner: string;
  receiverTokenId: string;
  tokenCount: number;
  transferredActionPoints: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
  revealed: boolean;
  totalActions: string;
  expired: boolean;
};

export type BurnedTokenRef = {
  tokenId: string;
  pixelCount: number;
};

export type BurnCommitmentDetail = BurnCommitmentSummary & {
  burnedTokens?: BurnedTokenRef[];
};

export async function fetchBurnsForReceiver(
  receiverTokenId: number,
  opts?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<BurnCommitmentSummary[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const base = getApiBase();
  const res = await fetch(
    `${base}/history/burns/receiver/${receiverTokenId}?limit=${limit}&offset=${offset}`,
    {
      signal: opts?.signal,
      headers: { Accept: "application/json" },
    },
  );
  return parseJson<BurnCommitmentSummary[]>(res);
}

export async function fetchBurnCommitDetail(
  commitId: string,
  signal?: AbortSignal,
): Promise<BurnCommitmentDetail> {
  const base = getApiBase();
  const res = await fetch(`${base}/history/burns/${commitId}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  return parseJson<BurnCommitmentDetail>(res);
}

/** One `setTransformBitmap` / canvas edit (indexer). API returns newest first. */
export type NormieTransformVersion = {
  version: number;
  changeCount: number;
  newPixelCount: number;
  transformer: string;
  blockNumber: string;
  timestamp: string;
  txHash: string;
};

export async function fetchNormieTransformVersions(
  tokenId: number,
  opts?: { limit?: number; offset?: number; signal?: AbortSignal },
): Promise<NormieTransformVersion[]> {
  const limit = opts?.limit ?? 80;
  const offset = opts?.offset ?? 0;
  const base = getApiBase();
  const res = await fetch(
    `${base}/history/normie/${tokenId}/versions?limit=${limit}&offset=${offset}`,
    {
      signal: opts?.signal,
      headers: { Accept: "application/json" },
    },
  );
  return parseJson<NormieTransformVersion[]>(res);
}
