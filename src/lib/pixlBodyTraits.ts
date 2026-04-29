/**
 * OpenSea-style attributes for Pixl bodies + helpers to merge with Normie API traits.
 * Body traits are derived from face pixels + generator sliders (deterministic).
 */

import {
  BODY_GRID,
  chinSpanFromFace,
  deriveTweak,
  parsePixels1600,
  type BodyGenOptions,
  type BodyTemplate,
} from "./normieBodyGenerator";

export type TraitAttribute = {
  trait_type: string;
  value: string | number;
  display_type?: string;
};

function faceFilledRatio(face: boolean[]): number {
  let n = 0;
  for (let i = 0; i < face.length; i++) if (face[i]) n++;
  return n / face.length;
}

function band3(t: number, low: string, mid: string, high: string): string {
  if (t < 1 / 3) return low;
  if (t < 2 / 3) return mid;
  return high;
}

/** Procedural “outfit / body” traits from sliders + chin + face density + hash noise. */
export function computePixlBodyTraits(input: {
  faceBits1600: string;
  opts: BodyGenOptions;
}): TraitAttribute[] {
  const { faceBits1600, opts } = input;
  const face = parsePixels1600(faceBits1600);
  const chin = chinSpanFromFace(face);
  const tweak = deriveTweak(faceBits1600, opts.styleT);
  const fill = faceFilledRatio(face);

  const shoulders =
    opts.shoulderBoost <= 2
      ? "Sleek"
      : opts.shoulderBoost <= 5
        ? "Regular"
        : opts.shoulderBoost <= 9
          ? "Bold"
          : "Max";

  const neck =
    chin.width <= 6 ? "Narrow" : chin.width <= 14 ? "Regular" : "Wide";

  const texture = band3(
    opts.styleT,
    "Clean edge",
    "Mixed edge",
    "Noisy edge",
  );

  const faceDensity = band3(fill, "Sparse face", "Balanced face", "Dense face");

  const weave = band3(tweak, "Tight weave", "Mid weave", "Loose weave");

  const template: BodyTemplate = input.opts.template ?? "standard";
  const outfitLabel =
    template === "standard"
      ? "Standard torso"
      : template.charAt(0).toUpperCase() + template.slice(1);

  const out: TraitAttribute[] = [
    { trait_type: "Pixl · Outfit", value: outfitLabel },
    {
      trait_type: "Pixl · Body panel",
      value: `${BODY_GRID}×${BODY_GRID}`,
    },
    { trait_type: "Pixl · Shoulder volume", value: shoulders },
    { trait_type: "Pixl · Neck fit", value: neck },
    { trait_type: "Pixl · Edge texture", value: texture },
    { trait_type: "Pixl · Face density", value: faceDensity },
    { trait_type: "Pixl · Weave", value: weave },
    {
      trait_type: "Pixl · Composite height",
      value: 40 + BODY_GRID,
      display_type: "number",
    },
    {
      trait_type: "Pixl · Shoulder boost",
      value: opts.shoulderBoost,
      display_type: "number",
    },
    {
      trait_type: "Pixl · Style t",
      value: Math.round(opts.styleT * 1000) / 1000,
      display_type: "number",
    },
  ];

  return out;
}

/** Normie on-chain traits + Pixl body traits in one array (mint / metadata preview). */
export function mergeTraitAttributes(
  normie: TraitAttribute[],
  pixl: TraitAttribute[],
): TraitAttribute[] {
  return [...normie, ...pixl];
}

export function traitsToOpenSeaAttributes(
  attrs: TraitAttribute[],
): { trait_type: string; value: string | number; display_type?: string }[] {
  return attrs.map((a) => ({
    trait_type: a.trait_type,
    value: a.value,
    ...(a.display_type ? { display_type: a.display_type } : {}),
  }));
}

/** Minimal NFT metadata blob for a snapshot-first outfit (you’d add image URI at mint). */
export function buildPixlMetadataPreview(input: {
  name: string;
  description: string;
  normieAttributes: TraitAttribute[];
  pixlAttributes: TraitAttribute[];
}): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description,
    attributes: traitsToOpenSeaAttributes(
      mergeTraitAttributes(input.normieAttributes, input.pixlAttributes),
    ),
  };
}
