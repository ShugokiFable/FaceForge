import { describe, expect, it } from "vitest";
import {
  inertDefinitions,
  resolveMorphAvailability,
  selectDefinitions
} from "./sliderCatalog";
import type { MorphRegistrySnapshot } from "./nativeBridge";

/**
 * The registry these fixtures model is the real shape of the defect found on 2026-08-05: a
 * High Poly Head character wears a 3832-vertex head, Expressive Facegen Morphs registers its
 * extension against the 996-vertex vanilla head, and RaceMenu still lists every EFM slider. The
 * slider is present, selectable, saveable -- and moves nothing.
 */
const registry = (
  overrides: Partial<MorphRegistrySnapshot> = {}
): MorphRegistrySnapshot => ({
  heads: [
    {
      chargenTriPath: "Actors\\Character\\Character Assets\\FemaleHeadChargen.tri",
      targetSex: "female",
      highPoly: false,
      vertexCount: 996,
      // The vanilla head carries the EFM morphs, so EFM_Face_Height works there.
      morphNames: ["EFM_Face_Long", "EFM_Face_Short", "CME_CheeksWidth_Up", "CME_CheeksWidth_Down"],
      parts: [],
      extensions: [],
      error: null
    },
    {
      chargenTriPath: "KL\\High Poly Head\\femaleheadchargen.tri",
      targetSex: "female",
      highPoly: true,
      vertexCount: 3832,
      // High Poly Head has the CME morphs (that addon ships an HP variant) but not the EFM ones.
      morphNames: ["CME_CheeksWidth_Up", "CME_CheeksWidth_Down"],
      parts: [],
      extensions: [],
      error: null
    }
  ],
  sliderSets: [
    {
      plugin: "Expressive Facegen Morphs.esl",
      iniPath: "sliders\\human.ini",
      sex: "female",
      races: ["NordRace", "BretonRace"],
      sliders: [
        {
          name: "EFM_Face_Height",
          negativeMorph: "EFM_Face_Short",
          positiveMorph: "EFM_Face_Long"
        }
      ]
    },
    {
      plugin: "ECE Sliders for Racemenu.esl",
      iniPath: "sliders\\human.ini",
      sex: "female",
      races: ["NordRace"],
      sliders: [
        {
          name: "CME_CheeksWidth",
          negativeMorph: "CME_CheeksWidth_Down",
          positiveMorph: "CME_CheeksWidth_Up"
        }
      ]
    }
  ],
  ...overrides
});

describe("resolveMorphAvailability", () => {
  it("calls a slider live when the head carries both halves of its morph pair", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: false,
      raceEditorId: "NordRace"
    });
    expect(available?.live.has("EFM_Face_Height")).toBe(true);
    expect(available?.inert.size).toBe(0);
  });

  it("calls the same slider inert on a head whose topology the morphs do not match", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "NordRace"
    });
    expect(available?.inert.has("EFM_Face_Height")).toBe(true);
    // The ECE addon ships a High Poly variant, so its slider survives the same head.
    expect(available?.live.has("CME_CheeksWidth")).toBe(true);
    expect(available?.headVertexCount).toBe(3832);
  });

  it("ignores slider sets the target race does not register", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "BretonRace"
    });
    expect(available?.inert.has("EFM_Face_Height")).toBe(true);
    // CME_CheeksWidth is a Nord-only set here, so a Breton target must not judge it at all.
    expect(available?.live.has("CME_CheeksWidth")).toBe(false);
    expect(available?.inert.has("CME_CheeksWidth")).toBe(false);
  });

  it("returns nothing when the install has no registry to read", () => {
    expect(
      resolveMorphAvailability(null, {
        sex: "female",
        highPolyHead: false,
        raceEditorId: "NordRace"
      })
    ).toBeNull();
  });
});

describe("selectDefinitions", () => {
  const inventory = {
    names: new Set(["EFM_Face_Height", "CME_CheeksWidth"]),
    fileName: "fixture.jslot",
    familyCounts: {}
  };

  it("drops a slider the target head cannot move", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "NordRace"
    });
    const names = selectDefinitions(inventory, available).map((item) => item.name);
    expect(names).not.toContain("EFM_Face_Height");
    expect(names).toContain("CME_CheeksWidth");
  });

  it("keeps that slider on a head that can move it", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: false,
      raceEditorId: "NordRace"
    });
    expect(selectDefinitions(inventory, available).map((item) => item.name)).toContain(
      "EFM_Face_Height"
    );
  });

  /**
   * The registry reads loose files. A slider ini shipped inside a BSA is invisible to it, so an
   * unknown slider must keep whatever the inventory decided -- treating "not found" as "inert"
   * would silently delete working sliders, which is a worse failure than the one being fixed.
   */
  it("keeps a slider the registry has never heard of", () => {
    const bare = registry({ sliderSets: [] });
    const available = resolveMorphAvailability(bare, {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "NordRace"
    });
    const names = selectDefinitions(inventory, available).map((item) => item.name);
    expect(names).toContain("EFM_Face_Height");
    expect(names).toContain("CME_CheeksWidth");
  });

  it("reports what it dropped so the UI can explain the gap", () => {
    const available = resolveMorphAvailability(registry(), {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "NordRace"
    });
    expect(inertDefinitions(inventory, available).map((item) => item.name)).toEqual([
      "EFM_Face_Height"
    ]);
  });
});
