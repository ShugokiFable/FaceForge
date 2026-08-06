import { describe, expect, it } from "vitest";
import {
  buildRaceMenuPreset,
  createFreshRaceMenuTemplate,
  parseRaceMenuTemplate,
  sanitizePresetName,
  serializeRaceMenuPreset
} from "./racemenu";

const validTemplate = JSON.stringify({
  actor: { weight: 50, hairColor: 123 },
  modNames: ["Skyrim.esm", "High Poly Head.esm"],
  headParts: [{ type: 1, formIdentifier: "High Poly Head.esm|000A06" }],
  morphs: {
    custom: [
      { name: "EFM_Nose_Width", value: 1.25 },
      { name: "CME_EyesUpDown", value: -0.4 }
    ],
    sculpt: {
      host: "KL\\High Poly Head\\FemaleHeadCharGen.tri",
      vertices: 3832,
      data: [[12, 1, 2, 3]]
    },
    sculptDivisor: 10000
  },
  version: {
    formatVersion: 3,
    runtimeVersion: 17039392,
    signature: 1163086675,
    skseVersion: 33554736
  }
});

describe("RaceMenu template engine", () => {
  it("parses format 3 evidence and dependencies", () => {
    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    expect(template.summary).toMatchObject({
      formatVersion: 3,
      headPartCount: 1,
      customMorphCount: 2,
      hasSculpt: true,
      weight: 50
    });
    expect(template.summary.dependencies).toEqual([
      "Expressive Facegen Morphs.esl",
      "High Poly Head.esm",
      "Skyrim.esm"
    ]);
    expect(template.summary.sculptHostCount).toBe(1);
  });

  it("parses multi-host sculpt arrays and head-part dependencies", () => {
    const document = JSON.parse(validTemplate);
    document.modNames = ["Skyrim.esm"];
    document.headParts.push({
      type: 8,
      formIdentifier: "Exact Brows.esp|000801"
    });
    document.morphs.sculpt = [
      document.morphs.sculpt,
      {
        host: "Actors\\Character\\Character Assets\\EyesFemaleChargen.tri",
        vertices: 176,
        data: []
      }
    ];
    const template = parseRaceMenuTemplate(JSON.stringify(document), "multi.jslot");
    expect(template.summary.sculptHostCount).toBe(2);
    expect(template.summary.sculptHosts).toContain(
      "Actors\\Character\\Character Assets\\EyesFemaleChargen.tri"
    );
    expect(template.summary.dependencies).toContain("Exact Brows.esp");
  });

  it("updates only generated EFM keys, clears sculpt, and clamps to the RaceMenu range", () => {
    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    const output = buildRaceMenuPreset(
      template,
      { EFM_Nose_Width: 3.4567, EFM_Lip_Width: -2, EFM_Jaw_Width: -9.1 },
      false
    );
    const morphs = output.morphs as {
      custom: Array<{ name: string; value: number }>;
      sculpt: unknown;
    };
    expect(morphs.sculpt).toBeNull();
    expect(morphs.custom).toContainEqual({ name: "CME_EyesUpDown", value: -0.4 });
    // Anything past the EFM slider range is truncated rather than written out of bounds; the
    // 0.6.0 packages carried values up to 8.5 and rendered as caricatures in game.
    expect(morphs.custom).toContainEqual({ name: "EFM_Nose_Width", value: 3 });
    expect(morphs.custom).toContainEqual({ name: "EFM_Jaw_Width", value: -3 });
    expect(morphs.custom).toContainEqual({ name: "EFM_Lip_Width", value: -2 });
    expect(output.actor).toEqual({ weight: 50, hairColor: 123 });
  });

  it("declares empty HPH sculpt hosts without inventing vertex deltas", () => {
    const template = createFreshRaceMenuTemplate();
    const output = buildRaceMenuPreset(
      template,
      { EFM_Jaw_Width: 1 },
      false,
      [],
      { highPolyHead: true, targetSex: "female" }
    );
    const morphs = output.morphs as {
      sculpt: Array<{ host: string; vertices: number; data: unknown[] }>;
    };
    expect(Array.isArray(morphs.sculpt)).toBe(true);
    expect(morphs.sculpt.length).toBeGreaterThanOrEqual(1);
    expect(morphs.sculpt[0].host).toContain("High Poly Head");
    expect(morphs.sculpt[0].vertices).toBe(3832);
    // D-004: hosts only — no guessed dx/dy/dz.
    expect(morphs.sculpt[0].data).toEqual([]);
  });

  it("preserves the existing sculpt when selected", () => {
    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    const output = buildRaceMenuPreset(template, { EFM_Jaw_Width: 2 }, true);
    const morphs = output.morphs as { sculpt: { host: string } };
    expect(morphs.sculpt.host).toContain("FemaleHeadCharGen.tri");
  });

  it("rejects wrong format versions and unsupported generated keys", () => {
    expect(() =>
      parseRaceMenuTemplate(
        JSON.stringify({ morphs: {}, version: { formatVersion: 2 } }),
        "old.jslot"
      )
    ).toThrow(/formatVersion 3/);

    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    // A family FaceForge has no established range for.
    expect(() => buildRaceMenuPreset(template, { ZZZ_GuessedKey: 4 }, false)).toThrow(
      /unsupported/
    );
    // An integer type selector: its value picks a numbered vanilla shape, so writing it as a
    // morph would silently swap the nose for whichever one happens to sit at that index.
    expect(() => buildRaceMenuPreset(template, { CME_NoseType: 12 }, false)).toThrow(
      /unsupported/
    );
  });

  it("clamps each family to its own range, not the EFM range", () => {
    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    const output = buildRaceMenuPreset(
      template,
      { EFM_Nose_Width: 5, CME_NoseLength: 5, NSK_MouthWidth: -5 },
      false
    );
    const morphs = output.morphs as { custom: Array<{ name: string; value: number }> };
    expect(morphs.custom).toContainEqual({ name: "EFM_Nose_Width", value: 3 });
    expect(morphs.custom).toContainEqual({ name: "CME_NoseLength", value: 1 });
    expect(morphs.custom).toContainEqual({ name: "NSK_MouthWidth", value: -1 });
  });

  it("rejects malformed and structurally incomplete templates", () => {
    expect(() => parseRaceMenuTemplate("{not json", "broken.jslot")).toThrow(
      /not valid JSON/
    );
    expect(() =>
      parseRaceMenuTemplate(
        JSON.stringify({ version: { formatVersion: 3 } }),
        "missing-morphs.jslot"
      )
    ).toThrow(/morphs/);

    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    expect(() => buildRaceMenuPreset(template, { EFM_Nose_Width: Number.NaN }, false)).toThrow(
      /finite/
    );
  });

  it("serializes valid JSON and sanitizes Windows file names", () => {
    const template = parseRaceMenuTemplate(validTemplate, "Base.jslot");
    const output = buildRaceMenuPreset(template, {}, true);
    expect(() => JSON.parse(serializeRaceMenuPreset(output))).not.toThrow();
    expect(sanitizePresetName('  My:Face*Preset?.jslot  ')).toBe("My_Face_Preset_");
  });

  it("builds a valid photo-first preset without a source JSlot", () => {
    const template = createFreshRaceMenuTemplate(65);
    const output = buildRaceMenuPreset(template, { EFM_Nose_Width: 2.5 }, false);
    expect(template.foundation).toBe("fresh");
    expect(template.summary.dependencies).toContain("Expressive Facegen Morphs.esl");
    expect(output.headParts).toEqual([]);
    expect(output.actor).toEqual({ weight: 65 });
    expect((output.morphs as { custom: unknown[] }).custom).toContainEqual({
      name: "EFM_Nose_Width",
      value: 2.5
    });
    expect(() =>
      parseRaceMenuTemplate(serializeRaceMenuPreset(output), "fresh.jslot")
    ).not.toThrow();
  });

  it("writes exact selected head-part records and their plugin dependencies", () => {
    const output = buildRaceMenuPreset(
      createFreshRaceMenuTemplate(),
      {},
      false,
      [
        { formIdentifier: "TRE_Brows.esp|000D92" },
        { formIdentifier: "Koralina's Eyebrows.esp|000800" }
      ]
    );
    expect(output.headParts).toEqual([
      { formIdentifier: "TRE_Brows.esp|000D92" },
      { formIdentifier: "Koralina's Eyebrows.esp|000800" }
    ]);
    expect(output.modNames).toEqual([
      "Expressive Facegen Morphs.esl",
      "Koralina's Eyebrows.esp",
      "Skyrim.esm",
      "TRE_Brows.esp"
    ]);
  });
});
