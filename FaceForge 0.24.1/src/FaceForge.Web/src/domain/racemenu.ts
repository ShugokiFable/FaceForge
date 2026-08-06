import { EFM_RANGE } from "./faceAnalysis";
import { hphSculptHostShell } from "./hphCalibration";
import type { TargetSex } from "./headPartPreferences";
import { FAMILY_RANGE, familyOf, INDEX_SLIDERS } from "./sliderCatalog";

export type JsonObject = Record<string, unknown>;

export interface RaceMenuTemplate {
  fileName: string;
  document: JsonObject;
  summary: TemplateSummary;
  companions?: TemplateCompanions;
  foundation: "fresh" | "template";
}

export interface TemplateCompanions {
  sourceId?: string | null;
  layout: string;
  hasNif: boolean;
  hasDds: boolean;
}

export interface TemplateSummary {
  formatVersion: number;
  dependencies: string[];
  headPartCount: number;
  customMorphCount: number;
  hasSculpt: boolean;
  sculptHost: string | null;
  sculptHosts: string[];
  sculptHostCount: number;
  weight: number | null;
}

export const EFM_PLUGIN = "Expressive Facegen Morphs.esl";

export interface SliderValue {
  name: string;
  value: number;
}

export interface RaceMenuHeadPart {
  formIdentifier: string;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asObject = (value: unknown, label: string): JsonObject => {
  if (!isObject(value)) {
    throw new Error(`Template is missing a valid ${label} object.`);
  }
  return value;
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readSculpt = (
  morphs: JsonObject
): { hasSculpt: boolean; host: string | null; hosts: string[] } => {
  const entries = Array.isArray(morphs.sculpt)
    ? morphs.sculpt.filter(isObject)
    : isObject(morphs.sculpt)
      ? [morphs.sculpt]
      : [];
  const hosts = entries
    .map((entry) => entry.host)
    .filter((host): host is string => typeof host === "string" && host.length > 0);
  return {
    hasSculpt: entries.length > 0,
    host: hosts[0] ?? null,
    hosts
  };
};

const readDependencies = (document: JsonObject): string[] => {
  const values = new Set<string>();
  const addPlugin = (value: unknown) => {
    if (
      typeof value === "string" &&
      /\.(?:esp|esm|esl)$/i.test(value.trim())
    ) {
      values.add(value.trim());
    }
  };

  if (Array.isArray(document.modNames)) {
    for (const value of document.modNames) addPlugin(value);
  }
  if (Array.isArray(document.mods)) {
    for (const value of document.mods) {
      if (isObject(value)) addPlugin(value.name);
    }
  }
  if (Array.isArray(document.headParts)) {
    for (const value of document.headParts) {
      if (!isObject(value) || typeof value.formIdentifier !== "string") continue;
      const separator = value.formIdentifier.indexOf("|");
      if (separator > 0) addPlugin(value.formIdentifier.slice(0, separator));
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b));
};

export function parseRaceMenuTemplate(
  text: string,
  fileName: string,
  companions?: TemplateCompanions
): RaceMenuTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON and cannot be used as a RaceMenu template.");
  }

  const document = asObject(parsed, "root");
  const version = asObject(document.version, "version");
  const formatVersion = asFiniteNumber(version.formatVersion);
  if (formatVersion !== 3) {
    throw new Error(
      `FaceForge 0.24.1 supports RaceMenu formatVersion 3; this file reports ${String(
        version.formatVersion ?? "none"
      )}.`
    );
  }

  const morphs = asObject(document.morphs, "morphs");
  if (morphs.custom !== undefined && !Array.isArray(morphs.custom)) {
    throw new Error("Template morphs.custom must be an array when present.");
  }

  const sculpt = readSculpt(morphs);
  const actor = isObject(document.actor) ? document.actor : {};

  return {
    fileName,
    document,
    companions,
    foundation: "template",
    summary: {
      formatVersion,
      dependencies: [...new Set([...readDependencies(document), EFM_PLUGIN])].sort((a, b) =>
        a.localeCompare(b)
      ),
      headPartCount: Array.isArray(document.headParts) ? document.headParts.length : 0,
      customMorphCount: Array.isArray(morphs.custom) ? morphs.custom.length : 0,
      hasSculpt: sculpt.hasSculpt,
      sculptHost: sculpt.host,
      sculptHosts: sculpt.hosts,
      sculptHostCount: sculpt.hosts.length,
      weight: asFiniteNumber(actor.weight)
    }
  };
}

export function createFreshRaceMenuTemplate(weight = 50): RaceMenuTemplate {
  const safeWeight = Number.isFinite(weight) ? Math.max(0, Math.min(100, weight)) : 50;
  const document: JsonObject = {
    actor: { weight: safeWeight },
    faceTextures: [],
    headParts: [],
    modNames: [EFM_PLUGIN, "Skyrim.esm"],
    mods: [],
    morphs: {
      custom: [],
      sculpt: null,
      sculptDivisor: 10000
    },
    tintInfo: [],
    version: {
      formatVersion: 3,
      runtimeVersion: 17039392,
      signature: 1163086675,
      skseVersion: 33685600
    }
  };
  return {
    fileName: "Photo-built fresh preset",
    document,
    foundation: "fresh",
    companions: {
      sourceId: null,
      layout: "faceforge-fresh",
      hasNif: false,
      hasDds: false
    },
    summary: {
      formatVersion: 3,
      dependencies: [EFM_PLUGIN, "Skyrim.esm"],
      headPartCount: 0,
      customMorphCount: 0,
      hasSculpt: false,
      sculptHost: null,
      sculptHosts: [],
      sculptHostCount: 0,
      weight: safeWeight
    }
  };
}

/**
 * Each slider family has its own range: EFM runs to +/-3, CME/NSK/SPG/RANs to +/-1. Clamping
 * everything to the EFM range would let a CME value be written three times too strong.
 */
const clampSlider = (name: string, value: number): number => {
  if (!Number.isFinite(value)) throw new Error("Generated slider values must be finite.");
  const family = familyOf(name);
  const range = family ? FAMILY_RANGE[family] : EFM_RANGE;
  return Math.max(-range, Math.min(range, Math.round(value * 1000) / 1000));
};

export function buildRaceMenuPreset(
  template: RaceMenuTemplate,
  sliders: Readonly<Record<string, number>>,
  preserveSculpt: boolean,
  selectedHeadParts: readonly RaceMenuHeadPart[] = [],
  /**
   * When the export targets High Poly Head and the template has no sculpt to preserve, declare
   * empty HPH host TRI entries so RaceMenu knows the topology. Never invents vertex deltas.
   */
  options: {
    highPolyHead?: boolean;
    targetSex?: TargetSex;
  } = {}
): JsonObject {
  const output = structuredClone(template.document);
  const morphs = asObject(output.morphs, "morphs");
  const existing = Array.isArray(morphs.custom) ? morphs.custom : [];
  const byName = new Map<string, JsonObject>();
  const passthrough: unknown[] = [];

  for (const entry of existing) {
    if (isObject(entry) && typeof entry.name === "string") {
      byName.set(entry.name, entry);
    } else {
      passthrough.push(entry);
    }
  }

  for (const [name, value] of Object.entries(sliders)) {
    // Only families FaceForge has established a range for, and never the integer type selectors,
    // whose values pick a numbered shape rather than scaling a morph.
    if (familyOf(name) === null || INDEX_SLIDERS.has(name)) {
      throw new Error(`Refusing to write unsupported generated slider key: ${name}`);
    }
    byName.set(name, { name, value: clampSlider(name, value) });
  }

  morphs.custom = [
    ...[...byName.values()].sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    ),
    ...passthrough
  ];

  if (preserveSculpt) {
    // Keep whatever sculpt the template already carried (inherited character base).
  } else if (options.highPolyHead) {
    // D-004: hosts only, empty data. Authors finish likeness in RaceMenu Sculpt / F5-F9.
    morphs.sculpt = hphSculptHostShell(options.targetSex ?? "female");
  } else {
    morphs.sculpt = null;
  }

  if (selectedHeadParts.length > 0) {
    const existing = Array.isArray(output.headParts) ? output.headParts : [];
    const seen = new Set(
      existing
        .filter(isObject)
        .map((part) => part.formIdentifier)
        .filter((value): value is string => typeof value === "string")
    );
    output.headParts = [
      ...existing,
      ...selectedHeadParts
        .filter((part) => !seen.has(part.formIdentifier))
        .map((part) => ({ formIdentifier: part.formIdentifier }))
    ];
    const mods = new Set(
      Array.isArray(output.modNames)
        ? output.modNames.filter((value): value is string => typeof value === "string")
        : []
    );
    for (const part of selectedHeadParts) {
      const separator = part.formIdentifier.indexOf("|");
      if (separator > 0) mods.add(part.formIdentifier.slice(0, separator));
    }
    output.modNames = [...mods].sort((a, b) => a.localeCompare(b));
  }

  return output;
}

export function serializeRaceMenuPreset(document: JsonObject): string {
  return `${JSON.stringify(document, null, 3)}\n`;
}

export function sanitizePresetName(value: string): string {
  const withoutExtension = value.trim().replace(/[. ]+$/g, "").replace(/\.jslot$/i, "");
  const safe = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (safe || "FaceForge_Preset").slice(0, 96);
}

export function triggerPresetDownload(contents: string, name: string): void {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizePresetName(name)}.jslot`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
