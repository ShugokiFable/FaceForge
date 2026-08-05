/**
 * Measures each playable race's real starting head.
 *
 * Skyrim's races share one head mesh; what makes a Nord head a Nord head is a named morph in
 * <sex>HeadRaces.tri applied over the same base vertices. So a race's head can be rendered and
 * measured exactly like the neutral one -- which is what this does, through the same detector and
 * the same measurement code that reads a photograph, for the same reason as
 * qa/calibrate-baselines.mjs: both sides of the comparison must come from identical arithmetic.
 *
 * It replaces the raceTargets multipliers, which until 0.20.0 were prose-derived estimates written
 * in 0.12.0. Those estimates were not merely imprecise. Describing Redguard as "strong cheek and
 * jaw geometry, moderately broad nose foundation" is a stereotype dressed as data, and it ranked
 * Redguard top for faces that look nothing like the actual RedguardRace head. The game states what
 * that head is; there was never a reason to guess.
 *
 * Run: preview server on 4173, then `node qa/calibrate-races.mjs`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "file:///C:/Users/karlo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = "Z:/Backup/!Skyrim AE/!!!SkyrimAEaiWorkspace/FaceForge/FaceForge 0.20.0";

/** Brow and iris are textures in Skyrim, so a render cannot judge them; see faceAnalysis.ts. */
const NO_GEOMETRY = new Set(["browHeight", "browAngle", "browWidth", "browThickness", "irisSize"]);
const UNSTABLE = new Set(["lipGap", "eyeTilt", "mouthAngle"]);

const heads = JSON.parse(await readFile(`${root}/qa/races/races.json`, "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });

const measured = {};
for (const head of heads) {
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await page.locator('input[type="file"]').nth(0).setInputFiles(`${root}/qa/races/${head.file}`);
  await page.getByRole("button", { name: "Analyze face" }).click();
  await page.waitForFunction(() => Boolean(window.faceForge?.analysis), null, { timeout: 60_000 });

  measured[head.id] = await page.evaluate(() => {
    const { analysis, baselines } = window.faceForge;
    // Same exact inversion of the trust fade as the baseline calibration.
    return Object.fromEntries(
      Object.entries(analysis.measurements).map(([key, value]) => {
        const confidence = analysis.trust[key];
        if (confidence >= 0.999) return [key, value.value];
        if (confidence < 0.35) return [key, null];
        return [key, baselines[key] + (value.value - baselines[key]) / confidence];
      })
    );
  });
  process.stdout.write(".");
}
await browser.close();
console.log();

// A factor is what this race's head measures divided by what the neutral head of the same sex
// measures. Averaging the two sexes keeps one table, as the app has always had, while letting each
// sex contribute its own head rather than assuming the female one speaks for both.
const keys = Object.keys(measured["female:Neutral"]).filter(
  (key) => !NO_GEOMETRY.has(key) && !UNSTABLE.has(key)
);
const races = [...new Set(heads.filter((head) => head.race !== "Neutral").map((h) => h.race))];
const table = {};
for (const race of races) {
  const factors = {};
  for (const key of keys) {
    const ratios = ["female", "male"]
      .map((sex) => {
        const base = measured[`${sex}:Neutral`][key];
        const value = measured[`${sex}:${race}`]?.[key];
        return base && value ? value / base : null;
      })
      .filter((ratio) => ratio !== null && Number.isFinite(ratio) && ratio > 0.2 && ratio < 5);
    if (ratios.length === 2) {
      factors[key] = Math.round((ratios[0] + ratios[1]) / 2 * 1000) / 1000;
    }
  }
  table[race] = factors;
}

await writeFile(
  `${root}/qa/race-calibration.json`,
  JSON.stringify({ generatedUtc: new Date().toISOString(), measured, table }, null, 2)
);

const shown = ["faceAspect", "jawWidth", "chinWidth", "cheekWidth", "noseWidth", "eyeWidth", "lowerFace"];
console.log(`${"race".padEnd(14)}${shown.map((key) => key.slice(0, 9).padStart(10)).join("")}`);
for (const [race, factors] of Object.entries(table)) {
  console.log(
    race.padEnd(14) + shown.map((key) => (factors[key] ?? 1).toFixed(3).padStart(10)).join("")
  );
}
console.log(`\n${Object.keys(table[races[0]]).length} measurements per race, identical set for all`);
