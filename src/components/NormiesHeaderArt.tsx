import { imageCompositedSvgUrl } from "../lib/normies-api";

/** Shown in page headers; composited art from the Normies API (CC0 collection). */
const SHOWCASE_TOKEN_ID = 9098;

type NormiesHeaderArtProps = {
  /** Override with the token the user is working on, when valid. */
  tokenId?: number | null;
};

export function NormiesHeaderArt({ tokenId }: NormiesHeaderArtProps) {
  const id =
    typeof tokenId === "number" &&
    Number.isFinite(tokenId) &&
    tokenId >= 0 &&
    tokenId <= 9999
      ? tokenId
      : SHOWCASE_TOKEN_ID;
  const src = imageCompositedSvgUrl(id);
  return (
    <img
      src={src}
      alt={`Normie #${id} (composited)`}
      className="normies-header-art"
      width={200}
      height={200}
      loading="lazy"
      decoding="async"
    />
  );
}
