/**
 * Detects a forehead covered by hair, so brow measurements taken off a fringe are distrusted
 * instead of exported as if they described a brow.
 *
 * Why this exists. MediaPipe's face mesh is a fixed-topology model: it returns all 478 points for
 * every detection, including brow points, whether or not the brow is visible. Given a subject with
 * a full fringe it places the brow landmarks somewhere plausible on the hair and reports normal
 * confidence. Nothing downstream can tell that reading apart from a real brow -- and on the export
 * that prompted this, it produced brow measurements sitting 70%, 78% and 168% away from their
 * reference, which pinned three sliders against their limit.
 *
 * The detector is deliberately a colour test rather than anything cleverer. A fringe is the one
 * occluder that reliably covers the whole forehead band, and hair is almost never the same colour
 * as the skin below it. Failure is safe in one direction only: a false positive costs the brow
 * axes, which are the least trustworthy measurements FaceForge takes anyway (their baselines are
 * estimates -- see ESTIMATED_BASELINES); a false negative just leaves the previous behaviour.
 *
 * Sampling is separated from scoring so the scoring can be tested without a canvas.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface OcclusionSamples {
  /** Known-skin reference patches: cheeks, which a fringe does not reach. */
  skin: readonly Rgb[];
  /** Mid-forehead, above the brow and below the hairline. */
  forehead: readonly Rgb[];
  /** The brow band itself. */
  brow: readonly Rgb[];
}

export interface OcclusionReading {
  /** 0 = forehead is bare skin, 1 = forehead is certainly something else. */
  forehead: number;
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const meanColour = (patches: readonly Rgb[]): Rgb => ({
  r: mean(patches.map((patch) => patch.r)),
  g: mean(patches.map((patch) => patch.g)),
  b: mean(patches.map((patch) => patch.b))
});

/**
 * Distance in a rough perceptual space: luminance carries most of the signal (hair is usually
 * darker or lighter than the face it sits on) and the two chroma differences catch the case where
 * a fringe happens to match the skin's brightness but not its hue. Scaled to 0-1 over the 0-255
 * channel range.
 */
export function colourDistance(a: Rgb, b: Rgb): number {
  const luma = (c: Rgb) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const dL = (luma(a) - luma(b)) / 255;
  const dRg = (a.r - a.g - (b.r - b.g)) / 255;
  const dBg = (a.b - a.g - (b.b - b.g)) / 255;
  return Math.sqrt(dL * dL + 0.5 * dRg * dRg + 0.5 * dBg * dBg);
}

/**
 * Thresholds. Skin varies across a face -- shading down the temples, blush on the cheeks -- so
 * some distance between two skin patches is normal; measured spread on unoccluded portraits sits
 * well under 0.10. Hair against skin clears 0.20 comfortably. The ramp between the two returns a
 * partial score rather than a hard switch, so a borderline case fades the brows partway instead of
 * flipping between full trust and none.
 */
export const SKIN_VARIATION = 0.1;
export const OCCLUDER_DISTANCE = 0.22;

/**
 * Scores forehead occlusion from sampled patches.
 *
 * The forehead is judged against the cheeks. The brow band is then a corroborating vote, but it
 * has to be read the right way round: comparing the brow to *skin* proves nothing, because a real
 * brow is a dark feature and always differs from the cheek beside it. The question is whether the
 * brow and the forehead are made of the same thing.
 *
 *   fringe          forehead = hair, brow = the same hair      -> the two agree, cover confirmed
 *   cast shadow     forehead = dim skin, brow = darker brow    -> the two differ, score damped
 *
 * So the vote is the *similarity* of brow to forehead, not the difference of either from skin.
 */
export function scoreOcclusion(samples: OcclusionSamples): OcclusionReading {
  if (samples.skin.length === 0 || samples.forehead.length === 0) return { forehead: 0 };
  const skin = meanColour(samples.skin);
  const forehead = meanColour(samples.forehead);
  const ramp = (distance: number) =>
    Math.max(0, Math.min(1, (distance - SKIN_VARIATION) / (OCCLUDER_DISTANCE - SKIN_VARIATION)));

  const foreheadScore = ramp(colourDistance(forehead, skin));
  if (foreheadScore === 0) return { forehead: 0 };
  if (samples.brow.length === 0) return { forehead: foreheadScore };

  const sameMaterial =
    1 - Math.min(1, colourDistance(meanColour(samples.brow), forehead) / OCCLUDER_DISTANCE);
  // Worth half: the forehead reading is the evidence, the brow only corroborates it.
  return { forehead: foreheadScore * (0.5 + 0.5 * sameMaterial) };
}

/** Below this the fade is not worth reporting or applying. */
export const OCCLUSION_REPORTING_FLOOR = 0.25;

export interface NormalisedPoint {
  x: number;
  y: number;
}

/**
 * Reads the three patch sets off a drawn frame. Coordinates are the normalised landmark space
 * MediaPipe returns. Returns null when no pixels are available -- a headless test environment, a
 * canvas the browser refuses to read back -- so callers fall through to the previous behaviour
 * rather than inventing a reading.
 */
export function sampleOcclusion(
  read: (x: number, y: number) => Rgb | null,
  landmarks: readonly NormalisedPoint[]
): OcclusionSamples | null {
  const at = (index: number): NormalisedPoint | null => landmarks[index] ?? null;
  const patch = (centre: NormalisedPoint | null, spread: number): Rgb[] => {
    if (!centre) return [];
    const offsets = [
      [0, 0],
      [spread, 0],
      [-spread, 0],
      [0, spread],
      [0, -spread]
    ];
    return offsets
      .map(([dx, dy]) => read(centre.x + dx, centre.y + dy))
      .filter((value): value is Rgb => value !== null);
  };

  // 50 and 280 sit on the cheeks, clear of the eyes and of the mouth's colour.
  const skin = [...patch(at(50), 0.012), ...patch(at(280), 0.012)];
  // 151 and 9 are forehead-centre points above the brows; 10 is the hairline itself and is
  // deliberately not used, because a normal hairline is hair on everyone.
  const forehead = [...patch(at(151), 0.015), ...patch(at(9), 0.01)];
  // 105 and 334 are the brow peaks the thickness measurement is taken from.
  const brow = [...patch(at(105), 0.008), ...patch(at(334), 0.008)];
  if (skin.length === 0 || forehead.length === 0) return null;
  return { skin, forehead, brow };
}
