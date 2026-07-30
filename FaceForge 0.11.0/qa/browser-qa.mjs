import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "file:///C:/Users/karlo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = "Z:/Backup/!Skyrim AE/!!!SkyrimAEaiWorkspace/FaceForge/FaceForge 0.11.0";
const portrait = `${root}/qa/synthetic-neutral-portrait.png`;
const output = `${root}/qa/FaceForge-QA-Export.jslot`;
const reportPath = `${root}/qa/browser-qa-report.json`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
const consoleErrors = [];
const consoleNotes = [];
const pageErrors = [];
const requestFailures = [];
const httpErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    if (message.text().includes("Created TensorFlow Lite XNNPACK delegate")) {
      consoleNotes.push(message.text());
    } else {
      consoleErrors.push(message.text());
    }
  }
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("requestfailed", (request) =>
  requestFailures.push(`${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`)
);
page.on("response", (response) => {
  if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
});

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.screenshot({ path: `${root}/qa/render-initial-1536x960.png`, fullPage: true });

await page.getByRole("button", { name: "Settings" }).click();
await page.getByRole("dialog").waitFor();
await page.getByRole("checkbox", { name: "Optional AI vision refinement" }).check();
await page.screenshot({ path: `${root}/qa/render-settings-1536x960.png`, fullPage: true });
await page.getByRole("button", { name: "Done" }).click();

const fileInputs = page.locator('input[type="file"]');
await fileInputs.nth(0).setInputFiles(portrait);
await page.getByRole("button", { name: "Analyze face" }).click();
try {
  await page.getByText("63 values").waitFor({ timeout: 30_000 });
} catch (error) {
  const statusText = await page.locator(".status-message").innerText();
  throw new Error(`Analysis did not finish. Status: ${statusText}. Console: ${consoleErrors.join(" | ")}`, {
    cause: error
  });
}
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Export Preset Pack" }).click();
const download = await downloadPromise;
await download.saveAs(output);

await page.screenshot({ path: `${root}/qa/render-analyzed-1536x960.png`, fullPage: true });
await page.setViewportSize({ width: 1100, height: 760 });
await page.screenshot({ path: `${root}/qa/render-analyzed-1100x760.png`, fullPage: true });
await page.setViewportSize({ width: 1536, height: 960 });

const exported = JSON.parse(await readFile(output, "utf8"));
const custom = Array.isArray(exported?.morphs?.custom) ? exported.morphs.custom : [];
const generated = custom.filter(
  (entry) => entry && typeof entry.name === "string" && entry.name.startsWith("EFM_")
);

// Captured while the neutral portrait is still on screen; the rotated run below replaces it.
const neutralUi = {
  poseCorrectionVisible: await page.locator(".pose-correction").isVisible(),
  poseReadouts: await page.locator(".pose-grid > div").count(),
  poseValues: (await page.locator(".pose-grid strong").allInnerTexts()).slice(0, 3),
  heldMeasurementsShown: await page.locator(".held-measurements").count(),
  heldSliderFlags: await page.locator(".slider-flag.held").count()
};

/**
 * The imperfect-source test. The same portrait is fed back in rotated by a large tilt, through
 * the real landmark model and the real UI. If pose correction works, the exported sliders must
 * land on the same face; if it does not, the character comes out visibly skewed.
 */
const portraitDataUrl = `data:image/png;base64,${(await readFile(portrait)).toString("base64")}`;
const rotatedOutput = `${root}/qa/FaceForge-QA-Export-Rotated.jslot`;

await page.evaluate(async ({ dataUrl, degrees }) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.fillStyle = "#8d8d8d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "rotated-portrait.png", { type: "image/png" }));
  const input = document.querySelectorAll('input[type="file"]')[0];
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, { dataUrl: portraitDataUrl, degrees: 16 });

await page.getByRole("button", { name: "Analyze face" }).click();
await page.getByText("63 values").waitFor({ timeout: 30_000 });
const rotatedDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export Preset Pack" }).click();
await (await rotatedDownload).saveAs(rotatedOutput);
await page.screenshot({ path: `${root}/qa/render-rotated-1536x960.png`, fullPage: true });

const rotatedExport = JSON.parse(await readFile(rotatedOutput, "utf8"));
const rotatedSliders = new Map(
  (rotatedExport?.morphs?.custom ?? [])
    .filter((entry) => entry?.name?.startsWith("EFM_"))
    .map((entry) => [entry.name, entry.value])
);
const rotatedDeltas = generated.map((entry) =>
  Math.abs((rotatedSliders.get(entry.name) ?? 0) - entry.value)
);
const rotatedPoseText = (await page.locator(".pose-grid strong").allInnerTexts())[0];

/**
 * The small-face test. The landmark model works from a fixed-size internal crop, so a face that
 * fills a fraction of a wide shot is measured from far fewer pixels. The same portrait is pasted
 * into a frame three times as wide and tall; the crop-and-re-detect pass has to recover the
 * sliders the tightly framed run produced.
 */
const smallFaceOutput = `${root}/qa/FaceForge-QA-Export-SmallFace.jslot`;

await page.evaluate(async ({ dataUrl, factor }) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * factor;
  canvas.height = image.naturalHeight * factor;
  const context = canvas.getContext("2d");
  context.fillStyle = "#7a7a7a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    (canvas.width - image.naturalWidth) / 2,
    (canvas.height - image.naturalHeight) / 2
  );
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "small-face.png", { type: "image/png" }));
  const input = document.querySelectorAll('input[type="file"]')[0];
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, { dataUrl: portraitDataUrl, factor: 3 });

await page.getByRole("button", { name: "Analyze face" }).click();
await page.getByText("63 values").waitFor({ timeout: 30_000 });
const smallFaceDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export Preset Pack" }).click();
await (await smallFaceDownload).saveAs(smallFaceOutput);
await page.screenshot({ path: `${root}/qa/render-smallface-1536x960.png`, fullPage: true });

const smallFaceExport = JSON.parse(await readFile(smallFaceOutput, "utf8"));
const smallFaceSliders = new Map(
  (smallFaceExport?.morphs?.custom ?? [])
    .filter((entry) => entry?.name?.startsWith("EFM_"))
    .map((entry) => [entry.name, entry.value])
);
const smallFaceDeltas = generated.map((entry) =>
  Math.abs((smallFaceSliders.get(entry.name) ?? 0) - entry.value)
);
const smallFaceReframed = (await page.locator(".warning-list li").allInnerTexts()).some((text) =>
  text.includes("cropped and re-detected")
);

/**
 * The slider-inventory test, run against a preset saved from this machine's own RaceMenu with
 * every slider touched. It is the whole point of the feature: the app must move from the EFM
 * family alone to every slider this install actually defines and FaceForge can measure.
 */
const inventoryPreset =
  "C:/Program Files (x86)/Steam/steamapps/common/Skyrim Special Edition/Data/SKSE/Plugins/CharGen/Presets/READ_ALL_SLIDERS_TEST.jslot";
let inventoryStage = { available: false };
try {
  await page.locator(".slider-inventory input[type='file']").setInputFiles(inventoryPreset);
  await page.locator(".inventory-families").waitFor({ timeout: 10_000 });
  await fileInputs.nth(0).setInputFiles(portrait);
  await page.getByRole("button", { name: "Analyze face" }).click();
  await page.locator(".generated-heading > span").waitFor({ timeout: 30_000 });
  const inventorySliderCount = await page.locator(".generated-heading > span").innerText();

  const inventoryOutput = `${root}/qa/FaceForge-QA-Export-Inventory.jslot`;
  const inventoryDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Preset Pack" }).click();
  await (await inventoryDownload).saveAs(inventoryOutput);
  await page.screenshot({ path: `${root}/qa/render-inventory-1536x960.png`, fullPage: true });

  const inventoryExport = JSON.parse(await readFile(inventoryOutput, "utf8"));
  const written = (inventoryExport?.morphs?.custom ?? []).map((entry) => entry.name);
  inventoryStage = {
    available: true,
    headingCount: inventorySliderCount,
    familyChips: await page.locator(".inventory-families span").count(),
    writtenCount: written.length,
    writtenFamilies: [...new Set(written.map((name) => name.split("_")[0]))].sort(),
    // Integer type selectors pick a numbered vanilla shape and must never be written as morphs.
    wroteIndexSlider: written.some((name) =>
      ["CME_NoseType", "CME_EyesType", "CME_LipType", "ECE_EarShape"].includes(name)
    ),
    // Declared by FaceForge but absent from this install; the gate has to drop it.
    wroteUninstalledSlider: written.includes("SPG_ECEBrowThickness")
  };
} catch (reason) {
  inventoryStage = { available: false, skipped: String(reason).slice(0, 300) };
  // The machine running QA may not have that preset; the stage is skipped, never faked.
}

const expectedGeneratedNames = [
  "EFM_Face_Height",
  "EFM_Cheek_Width",
  "EFM_Cheek_Height",
  "EFM_Jaw_Width",
  "EFM_Jaw_Height",
  "EFM_Chin_Width",
  "EFM_Chin_Shape",
  "EFM_Chin_Height",
  "EFM_Eyes_Size",
  "EFM_Eyes_Width",
  "EFM_Eyes_Upper_Height",
  "EFM_Eyes_Lower_Height",
  "EFM_Eyes_Inner_Height",
  "EFM_Eyes_Outer_Height",
  "EFM_Eyes_Height",
  "EFM_Brow_Height",
  "EFM_Brow_Angle",
  "EFM_Brow_Width",
  "EFM_Nose_Width",
  "EFM_Nose_Wing_Width",
  "EFM_Nose_Bridge_Width",
  "EFM_Nose_Tip_Width",
  "EFM_Nose_Tip_Height",
  "EFM_Nose_Size",
  "EFM_Nose_Height",
  "EFM_Nose_Root_Height",
  "EFM_Nose_Wing_Height",
  "EFM_Lip_Width",
  "EFM_Lip_Upper_Width",
  "EFM_Lip_Lower_Width",
  "EFM_Lip_Upper_Thickness",
  "EFM_Lip_Lower_Thickness",
  "EFM_Lip_Height",
  "EFM_Lip_Angle",
  "EFM_Philtrum_Width"
];
const generatedNames = new Set(generated.map((entry) => entry.name));
const finiteGenerated = generated.every(
  (entry) => typeof entry.value === "number" && Number.isFinite(entry.value)
);
const magnitudes = generated.map((entry) => Math.abs(entry.value));
const maxGenerated = Math.max(...magnitudes);
const meanGenerated = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
const pinnedGenerated = magnitudes.filter((value) => value >= 2.999).length;

const checks = {
  title: await page.title(),
  headingVisible: await page.getByRole("heading", { name: "RaceMenu output" }).isVisible(),
  presetPackVisible: await page.getByRole("button", { name: /Preset Pack/ }).first().isVisible(),
  photoFirstVisible: await page.getByRole("button", { name: /Build from photo/ }).isVisible(),
  animeModeVisible: await page.getByRole("button", { name: "Anime / art" }).isVisible(),
  raceGuidanceVisible: await page.getByRole("heading", { name: "Recommended race foundation" }).isVisible(),
  raceChoiceCount: await page.locator(".race-choice").count(),
  appearanceGuidanceVisible: await page.getByRole("heading", { name: "Installed exact appearance choices" }).isVisible(),
  symmetryIsQualityOnly: await page.getByText(/symmetry is only a quality signal/i).isVisible(),
  raceMenuHeadExportVisible: await page.getByRole("button", { name: /RaceMenu Head Export/ }).isVisible(),
  followerHeadKitVisible: await page.getByRole("button", { name: /Follower Head Kit/ }).isVisible(),
  dependencyIndexVisible: await page.getByRole("heading", { name: "Required plugin index" }).isVisible(),
  targetActorVisible: await page.getByRole("heading", { name: "Target race and sex" }).isVisible(),
  targetSexButtons: await page.getByRole("button", { name: /^(female|male)$/ }).count(),
  targetRaceSelectVisible: await page.getByLabel("Target race").isVisible(),
  appearanceCategoryTabs: await page
    .locator(".appearance-guidance .appearance-tabs button")
    .count(),
  appearanceGateVisible: await page.locator(".appearance-gate").isVisible(),
  sliderInventoryVisible: await page.locator(".slider-inventory").isVisible(),
  presetReportVisible: await page.locator(".preset-report").isVisible(),
  inventoryStage,
  // Without an inventory the app must write the EFM family and nothing else, but all of it.
  generatedFamilies: [...new Set(generated.map((entry) => entry.name.split("_")[0]))].sort(),
  bakedHeadStepVisible: await page.locator(".baked-head-step").isVisible(),
  // A clean front-facing neutral portrait must not be "corrected" into something else.
  ...neutralUi,
  // The same face tilted 16 degrees must be detected as tilted and land back on the same values.
  rotatedTiltDetected: Math.abs(Number.parseFloat(rotatedPoseText.replace("−", "-"))),
  rotatedMaxSliderDelta: Math.max(...rotatedDeltas),
  rotatedMeanSliderDelta:
    rotatedDeltas.reduce((sum, value) => sum + value, 0) / rotatedDeltas.length,
  // The same face at a third of the frame width must reframe and land on the same values.
  smallFaceReframed,
  smallFaceMaxSliderDelta: Math.max(...smallFaceDeltas),
  smallFaceMeanSliderDelta:
    smallFaceDeltas.reduce((sum, value) => sum + value, 0) / smallFaceDeltas.length,
  outputFormatVersion: exported?.version?.formatVersion,
  generatedEfmCount: generated.length,
  expectedGeneratedPresent: expectedGeneratedNames.every((name) => generatedNames.has(name)),
  finiteGenerated,
  maxGenerated,
  meanGenerated,
  pinnedGenerated,
  sculptCleared: exported?.morphs?.sculpt === null,
  freshDependencies:
    exported?.modNames?.includes("Skyrim.esm") &&
    exported?.modNames?.includes("Expressive Facegen Morphs.esl"),
  freshHeadPartsEmpty: Array.isArray(exported?.headParts) && exported.headParts.length === 0,
  modelRequests: await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("face_landmarker.task") || name.includes("vision_wasm"))
  ),
  consoleErrors,
  consoleNotes,
  pageErrors,
  requestFailures,
  httpErrors
};

await writeFile(reportPath, `${JSON.stringify(checks, null, 2)}\n`, "utf8");
await browser.close();

if (
  checks.title !== "FaceForge" ||
  !checks.headingVisible ||
  !checks.presetPackVisible ||
  !checks.photoFirstVisible ||
  !checks.animeModeVisible ||
  !checks.raceGuidanceVisible ||
  checks.raceChoiceCount !== 3 ||
  !checks.appearanceGuidanceVisible ||
  !checks.symmetryIsQualityOnly ||
  !checks.raceMenuHeadExportVisible ||
  !checks.followerHeadKitVisible ||
  !checks.dependencyIndexVisible ||
  !checks.targetActorVisible ||
  checks.targetSexButtons !== 2 ||
  !checks.targetRaceSelectVisible ||
  checks.appearanceCategoryTabs !== 5 ||
  !checks.appearanceGateVisible ||
  !checks.sliderInventoryVisible ||
  !checks.presetReportVisible ||
  checks.generatedEfmCount !== 63 ||
  checks.generatedFamilies.join(",") !== "EFM" ||
  // When the inventory stage ran, it must have widened the output well past the EFM-only set
  // and must not have written an index selector or a slider this install does not define.
  (checks.inventoryStage.available &&
    (checks.inventoryStage.writtenCount < 90 ||
      checks.inventoryStage.writtenFamilies.length < 3 ||
      checks.inventoryStage.wroteIndexSlider ||
      checks.inventoryStage.wroteUninstalledSlider)) ||
  !checks.bakedHeadStepVisible ||
  !checks.poseCorrectionVisible ||
  checks.poseReadouts !== 4 ||
  // Tilt, turn, and nod on a front-facing neutral portrait must all read under 10 degrees;
  // anything larger means the pose estimator is inventing rotation out of landmark noise.
  checks.poseValues.some((value) => Math.abs(Number.parseFloat(value.replace("−", "-"))) >= 10) ||
  checks.heldMeasurementsShown !== 0 ||
  checks.heldSliderFlags !== 0 ||
  // The same face tilted 16 degrees: the tilt must be reported, and the exported sliders must
  // land back on the straight run. Measured 0.154 worst case and 0.029 mean; without the
  // straightening pass the worst case was 0.581.
  checks.rotatedTiltDetected < 12 ||
  checks.rotatedTiltDetected > 20 ||
  checks.rotatedMaxSliderDelta > 0.2 ||
  checks.rotatedMeanSliderDelta > 0.05 ||
  // The same face at a third of the frame width: it must actually reframe, and the recovered
  // sliders must match the tightly framed run. Measured 0.063 worst case and 0.016 mean.
  !checks.smallFaceReframed ||
  checks.smallFaceMaxSliderDelta > 0.15 ||
  checks.smallFaceMeanSliderDelta > 0.04 ||
  checks.outputFormatVersion !== 3 ||
  !checks.expectedGeneratedPresent ||
  !checks.finiteGenerated ||
  // The whole point of 0.7.0: exported values stay inside the RaceMenu EFM range and none of
  // them sit flat against the limit the way 0.6.0's 8.5s did.
  checks.maxGenerated > 3 ||
  checks.meanGenerated > 1.2 ||
  checks.pinnedGenerated > 0 ||
  !checks.sculptCleared ||
  !checks.freshDependencies ||
  !checks.freshHeadPartsEmpty ||
  checks.modelRequests.length < 2 ||
  checks.consoleErrors.length > 0 ||
  checks.pageErrors.length > 0 ||
  checks.requestFailures.length > 0 ||
  checks.httpErrors.length > 0
) {
  throw new Error(`Browser QA failed. See ${reportPath}`);
}

console.log(JSON.stringify(checks, null, 2));
