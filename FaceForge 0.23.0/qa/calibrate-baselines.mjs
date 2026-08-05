/**
 * Measures the neutral Skyrim head with the same pipeline that measures a photograph.
 *
 * FaceForge compares a face against `measurementBaselines` in faceAnalysis.ts. Those numbers were
 * estimated, and every exported slider inherits the error. The fix is not a better estimate: it is
 * to run a render of the all-zero-slider head through the real detector and the real measurement
 * code, so both sides of the comparison come from identical arithmetic and any systematic bias in
 * that arithmetic cancels instead of accumulating.
 *
 * The renders in qa/heads are front orthographic views of the CharGen .tri base vertices -- the
 * head as it exists before any morph is applied. qa/render-head.py made them.
 *
 * Run: preview server on 4173, then `node qa/calibrate-baselines.mjs`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "file:///C:/Users/karlo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = "Z:/Backup/!Skyrim AE/!!!SkyrimAEaiWorkspace/FaceForge/FaceForge 0.20.0";
const heads = [
  { id: "vanillaFemale", label: "vanilla female", file: "vanilla_female.png", vertices: 996 },
  { id: "highPolyFemale", label: "High Poly Head female", file: "hph_female.png", vertices: 3832 },
  { id: "vanillaMale", label: "vanilla male", file: "vanilla_male.png", vertices: 898 },
  { id: "highPolyMale", label: "High Poly Head male", file: "hph_male.png", vertices: 3598 }
];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("XNNPACK")) {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });

const results = [];
for (const head of heads) {
  await page.reload({ waitUntil: "networkidle" });

  // A flat-shaded render is not a photograph, and Auto could classify it as stylized art and
  // apply realism normalization -- which would measure a corrected head rather than the head.
  await page.getByRole("button", { name: "Photo", exact: true }).click();

  await page.locator('input[type="file"]').nth(0).setInputFiles(`${root}/qa/heads/${head.file}`);
  await page.getByRole("button", { name: "Analyze face" }).click();
  await page.waitForFunction(() => Boolean(window.faceForge?.analysis), null, { timeout: 60_000 });

  const analysis = await page.evaluate(() => {
    const { analysis: current, baselines } = window.faceForge;
    return {
      baselines,
      measurements: Object.fromEntries(
        Object.entries(current.measurements).map(([key, value]) => [key, value.value])
      ),
      trust: current.trust,
      symmetry: current.symmetry,
      rollDegrees: current.rollDegrees,
      yawOffset: current.yawOffset,
      warnings: current.warnings
    };
  });

  // A measurement the pipeline distrusts is reported as baseline + (measured - baseline) * trust.
  // That blend is exactly invertible, so a partly contaminated reading still yields the number the
  // detector actually saw -- important here because the eye family reads as narrowed on every
  // render, and discarding it would leave those baselines at the guesses being replaced. Below a
  // third of trust the division amplifies noise more than it recovers signal, so it is dropped.
  analysis.recovered = Object.fromEntries(
    Object.entries(analysis.measurements).map(([key, value]) => {
      const confidence = analysis.trust[key];
      if (confidence >= 0.999) return [key, value];
      if (confidence < 0.35) return [key, null];
      const baseline = analysis.baselines[key];
      return [key, baseline + (value - baseline) / confidence];
    })
  );

  results.push({ ...head, ...analysis });
  const dropped = Object.values(analysis.recovered).filter((value) => value === null).length;
  console.log(
    `${head.label.padEnd(24)} roll ${analysis.rollDegrees.toFixed(2)}  yaw ${analysis.yawOffset.toFixed(3)}  ` +
      `symmetry ${analysis.symmetry.toFixed(3)}  unrecoverable ${dropped}`
  );
}

await browser.close();

/**
 * Skyrim's eyebrows are a texture on a plain forehead slab and the iris is a texture on a plain
 * sphere, so a render of the mesh has neither. The detector still returns brow and iris landmarks,
 * placed on the brow ridge and the eyeball, and reports full confidence in them -- they measure
 * something real, just not the thing a photograph measures. Calibrating against them would trade a
 * guess for a confidently wrong number.
 */
const NO_GEOMETRY = new Set([
  "browHeight",
  "browAngle",
  "browWidth",
  "browThickness",
  "irisSize"
]);

const keys = Object.keys(results[0].measurements);
const verdicts = keys.map((key) => {
  const values = results.map((entry) => entry.recovered[key]).filter((value) => value !== null);
  const mean = values.reduce((total, value) => total + value, 0) / (values.length || 1);
  const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const spread = mean === 0 ? 0 : Math.abs(range / mean);
  const reject = NO_GEOMETRY.has(key)
    ? "the neutral mesh does not carry the feature"
    : values.length < results.length
      ? `${results.length - values.length} of ${results.length} heads could not measure it`
      : spread > 0.5
        ? `the heads disagree by ${Math.round(spread * 100)}% of the mean`
        : null;
  return { key, mean: Number(mean.toFixed(4)), range, spread, count: values.length, reject };
});

const accepted = verdicts.filter((entry) => !entry.reject);
console.log(`\naccepted ${accepted.length} of ${keys.length} baselines`);
for (const entry of verdicts.filter((item) => item.reject)) {
  console.log(`  kept estimated: ${entry.key.padEnd(18)} ${entry.reject}`);
}
console.log("\n" + accepted.map((entry) => `  ${entry.key}: ${entry.mean},`).join("\n"));

await writeFile(
  `${root}/qa/baseline-calibration.json`,
  JSON.stringify({ generatedUtc: new Date().toISOString(), heads: results, verdicts }, null, 2)
);
console.log(`\nconsole errors: ${consoleErrors.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join("\n"));
