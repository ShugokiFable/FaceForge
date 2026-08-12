import { describe, expect, it } from "vitest";
import {
  OCCLUDER_DISTANCE,
  SKIN_VARIATION,
  colourDistance,
  sampleOcclusion,
  scoreOcclusion,
  type Rgb
} from "./occlusion";

/** Pale skin, medium-brown fringe: the case from the export that prompted this. */
const SKIN: Rgb = { r: 236, g: 200, b: 190 };
const HAIR: Rgb = { r: 120, g: 96, b: 76 };
const BROW_ON_SKIN: Rgb = { r: 150, g: 120, b: 104 };
const SHADED_SKIN: Rgb = { r: 214, g: 180, b: 172 };
/** Deep enough that the forehead alone would read as covered; the brow below it is darker still. */
const SHADOWED_FOREHEAD: Rgb = { r: 168, g: 140, b: 132 };

const patches = (colour: Rgb, count = 5): Rgb[] => Array.from({ length: count }, () => colour);

describe("colourDistance", () => {
  it("keeps two patches of the same skin inside the normal-variation band", () => {
    expect(colourDistance(SKIN, SHADED_SKIN)).toBeLessThan(SKIN_VARIATION);
  });

  it("puts hair against skin past the occluder threshold", () => {
    expect(colourDistance(SKIN, HAIR)).toBeGreaterThan(OCCLUDER_DISTANCE);
  });
});

describe("scoreOcclusion", () => {
  it("reports a bare forehead as unoccluded", () => {
    const reading = scoreOcclusion({
      skin: patches(SKIN),
      forehead: patches(SHADED_SKIN),
      brow: patches(BROW_ON_SKIN)
    });
    expect(reading.forehead).toBe(0);
  });

  it("reports a fringe over the forehead", () => {
    const reading = scoreOcclusion({
      skin: patches(SKIN),
      forehead: patches(HAIR),
      brow: patches(HAIR)
    });
    expect(reading.forehead).toBeGreaterThan(0.9);
  });

  /**
   * A cast shadow darkens the forehead without covering the brow. Trusting that as hair would
   * throw away a usable brow reading, so a brow that is still visibly a distinct feature -- darker
   * than the forehead above it -- damps the score.
   */
  it("damps a dark forehead whose brow still reads as a separate feature", () => {
    const shadowOnly = scoreOcclusion({
      skin: patches(SKIN),
      forehead: patches(SHADOWED_FOREHEAD),
      brow: patches(BROW_ON_SKIN)
    });
    const fringe = scoreOcclusion({
      skin: patches(SKIN),
      forehead: patches(HAIR),
      brow: patches(HAIR)
    });
    expect(shadowOnly.forehead).toBeLessThan(fringe.forehead);
  });

  it("returns zero rather than guessing when there is nothing to compare", () => {
    expect(scoreOcclusion({ skin: [], forehead: patches(HAIR), brow: [] }).forehead).toBe(0);
  });
});

describe("sampleOcclusion", () => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));

  it("returns null when no pixels can be read", () => {
    expect(sampleOcclusion(() => null, landmarks)).toBeNull();
  });

  it("collects all three patch sets from a readable frame", () => {
    const samples = sampleOcclusion(() => SKIN, landmarks);
    expect(samples).not.toBeNull();
    expect(samples!.skin.length).toBeGreaterThan(0);
    expect(samples!.forehead.length).toBeGreaterThan(0);
    expect(samples!.brow.length).toBeGreaterThan(0);
  });
});
