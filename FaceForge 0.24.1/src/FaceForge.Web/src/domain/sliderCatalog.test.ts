import { describe, expect, it } from "vitest";
import {
  inertDefinitions,
  oneFamilyPerMeasurement,
  resolveMorphAvailability,
  selectDefinitions,
  SLIDER_DEFINITIONS,
  supersededDefinitions
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
  complete: true,
  unreadArchives: [],
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

describe("an incomplete registry", () => {
  /**
   * The 0.23.0 regression, pinned. High Poly Head registers its KL-topology CME/ECE/EFM/RANs/NUSKA
   * morph set from a morphs.ini packed inside High Poly Head.bsa. The loose-file read cannot open
   * it, so every EFM slider looked dead and ~42 working sliders were dropped from real presets.
   */
  it("never reports a slider inert", () => {
    const partial = registry({ complete: false, unreadArchives: ["High Poly Head.bsa"] });
    expect(
      resolveMorphAvailability(partial, {
        sex: "female",
        highPolyHead: true,
        raceEditorId: "NordRace"
      })
    ).toBeNull();
  });

  it("leaves every measurable slider in the preset", () => {
    const partial = registry({ complete: false, unreadArchives: ["High Poly Head.bsa"] });
    const inventory = {
      names: new Set(["EFM_Face_Height", "CME_CheeksWidth"]),
      fileName: "fixture.jslot",
      familyCounts: {}
    };
    const available = resolveMorphAvailability(partial, {
      sex: "female",
      highPolyHead: true,
      raceEditorId: "NordRace"
    });
    const names = selectDefinitions(inventory, available).map((item) => item.name);
    expect(names).toContain("EFM_Face_Height");
    expect(names).toContain("CME_CheeksWidth");
    expect(inertDefinitions(inventory, available)).toEqual([]);
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

/**
 * Shipped from 0.6.0 to 0.23.2: one measurement written into every family that offers a slider
 * for it. The families are separate mods registering separate morph targets and RaceMenu sums
 * them, so this applied the same displacement two to four times. Measured on the real export that
 * exposed it -- brow height landed on EFM_Brow_Height 2.30, CME_BrowUpDown 0.99,
 * SPG_ECEBrowInnerHeight 0.99 and SPG_ECEBrowOuterHeight 0.98 at once.
 */
describe("one family per measurement", () => {
  const named = (names: string[]) => ({
    names: new Set(names),
    fileName: "fixture.jslot",
    familyCounts: {}
  });

  it("writes brow height once when four sliders offer it", () => {
    const names = selectDefinitions(
      named([
        "EFM_Brow_Height",
        "CME_BrowUpDown",
        "SPG_ECEBrowInnerHeight",
        "SPG_ECEBrowOuterHeight"
      ])
    ).map((item) => item.name);
    expect(names).toEqual(["EFM_Brow_Height"]);
  });

  it("falls back to the best family the install actually has", () => {
    const names = selectDefinitions(
      named(["CME_BrowUpDown", "SPG_ECEBrowInnerHeight", "SPG_ECEBrowOuterHeight"])
    ).map((item) => item.name);
    expect(names).toEqual(["CME_BrowUpDown"]);
  });

  it("keeps a family EFM has no slider for", () => {
    const names = selectDefinitions(named(["EFM_Brow_Height", "NSK_EyeAngle"])).map(
      (item) => item.name
    );
    expect(names).toContain("NSK_EyeAngle");
  });

  /**
   * The collapse is across families, never inside one. EFM_Nose_Width, EFM_Nose_Wing_Width and
   * EFM_Nose_Wing_Thickness are three pieces of anatomy an author moves together; removing two of
   * them would be the 0.23.0 mistake in a new costume.
   */
  it("leaves a single family's own fan-out alone", () => {
    const names = selectDefinitions(
      named(["EFM_Nose_Width", "EFM_Nose_Wing_Width", "EFM_Nose_Wing_Thickness"])
    ).map((item) => item.name);
    expect(names).toHaveLength(3);
  });

  it("names the duplicates it held back so the UI can say why the count fell", () => {
    const inventory = named(["EFM_Brow_Height", "CME_BrowUpDown"]);
    expect(supersededDefinitions(inventory).map((item) => item.name)).toEqual([
      "CME_BrowUpDown"
    ]);
  });

  it("leaves no measurement driving two families anywhere in the catalogue", () => {
    const families = new Map<string, Set<string>>();
    for (const item of oneFamilyPerMeasurement(SLIDER_DEFINITIONS)) {
      const family = item.name.split("_")[0];
      const seen = families.get(item.source) ?? new Set<string>();
      seen.add(family);
      families.set(item.source, seen);
    }
    const offenders = [...families.entries()].filter(([, set]) => set.size > 1);
    expect(offenders).toEqual([]);
  });
});
