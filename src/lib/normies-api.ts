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

/** Current token ids for a wallet (Ponder ownership index, not full tx history). */
export type HoldersResponse = {
  address: string;
  tokenIds: string[];
};

export function normalizeWalletAddress(input: string): string | null {
  const s = input.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return null;
  return s.toLowerCase();
}

export async function fetchHolderTokenIds(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<HoldersResponse> {
  const normalized = normalizeWalletAddress(walletAddress);
  if (!normalized) {
    throw new Error(
      "Enter a valid 0x-prefixed address (20 bytes / 40 hex chars).",
    );
  }
  const base = getApiBase();
  const res = await fetch(`${base}/holders/${normalized}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  return parseJson<HoldersResponse>(res);
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

/** Composited SVG (1000×1000, 40×40 viewBox per API). */
export function imageCompositedSvgUrl(id: number): string {
  return `${getApiBase()}/normie/${id}/image.svg`;
}

/** Pre-transform SVG. */
export function imageOriginalSvgUrl(id: number): string {
  return `${getApiBase()}/normie/${id}/original/image.svg`;
}

/** 1600-char `0`/`1` bitmap (row-major 40×40), composited or original. */
/** Decoded Normie traits from `GET /normie/:id/traits` (same shape as typical NFT metadata). */
export type NormieTraitAttribute = {
  trait_type: string;
  value: string | number;
  display_type?: string;
};

export type NormieTraitsResponse = {
  raw: string;
  attributes: NormieTraitAttribute[];
};

export async function fetchNormieTraits(
  id: number,
  signal?: AbortSignal,
): Promise<NormieTraitsResponse> {
  const base = getApiBase();
  const res = await fetch(`${base}/normie/${id}/traits`, {
    signal,
    headers: { Accept: "application/json" },
  });
  return parseJson<NormieTraitsResponse>(res);
}

/** 1600-char `0`/`1` bitmap (row-major 40×40), composited or original. */
export async function fetchNormiePixelsPlain(
  id: number,
  original: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const base = getApiBase();
  const path = original
    ? `/normie/${id}/original/pixels`
    : `/normie/${id}/pixels`;
  const res = await fetch(`${base}${path}`, {
    signal,
    headers: { Accept: "text/plain,*/*" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  const raw = (await res.text()).replace(/\s/g, "");
  const bits = [...raw].filter((c) => c === "0" || c === "1").join("");
  if (bits.length !== 1600) {
    throw new Error(
      `Expected 1600 binary pixel chars (0/1), got ${bits.length} after filtering (raw length ${raw.length}).`,
    );
  }
  return bits;
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

/** Composited PNG at a transform version (0 = first edit). */
export function normieVersionImagePngUrl(
  tokenId: number,
  versionIndex: number,
): string {
  return `${getApiBase()}/history/normie/${tokenId}/version/${versionIndex}/image.png`;
}
