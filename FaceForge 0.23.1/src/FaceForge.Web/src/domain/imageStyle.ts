export type SourceMode = "auto" | "photograph" | "stylized";
export type DetectedSourceKind = "photograph" | "stylized";

export interface StyleAssessment {
  kind: DetectedSourceKind;
  confidence: number;
  method: "automatic" | "user-selected";
  realismStrength: number;
  notes: string[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function assessImageStyle(
  image: HTMLImageElement,
  sourceMode: SourceMode
): StyleAssessment {
  if (sourceMode !== "auto") {
    const stylized = sourceMode === "stylized";
    return {
      kind: stylized ? "stylized" : "photograph",
      confidence: 1,
      method: "user-selected",
      realismStrength: stylized ? 0.62 : 0,
      notes: [
        stylized
          ? "Illustration mode will reduce exaggerated art proportions while retaining distinctive shape cues."
          : "Photograph mode preserves measured proportions without illustration normalization."
      ]
    };
  }

  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      kind: "photograph",
      confidence: 0.5,
      method: "automatic",
      realismStrength: 0,
      notes: ["Image-style sampling was unavailable; photograph behavior was used."]
    };
  }
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const colorBins = new Set<number>();
  let saturationTotal = 0;
  let edgeCount = 0;
  let comparisons = 0;
  const luminance = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixelIndex = (y * size + x) * 4;
      const r = pixels[pixelIndex];
      const g = pixels[pixelIndex + 1];
      const b = pixels[pixelIndex + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturationTotal += max === 0 ? 0 : (max - min) / max;
      colorBins.add(((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5));
      luminance[y * size + x] = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (x > 0) {
        comparisons += 1;
        if (Math.abs(luminance[y * size + x] - luminance[y * size + x - 1]) > 42)
          edgeCount += 1;
      }
      if (y > 0) {
        comparisons += 1;
        if (Math.abs(luminance[y * size + x] - luminance[(y - 1) * size + x]) > 42)
          edgeCount += 1;
      }
    }
  }

  const saturation = saturationTotal / (size * size);
  const edgeDensity = comparisons > 0 ? edgeCount / comparisons : 0;
  const paletteCompression = 1 - colorBins.size / 512;
  const stylizedScore = clamp01(
    (edgeDensity - 0.075) * 4.2 +
    (paletteCompression - 0.52) * 1.05 +
    Math.max(0, saturation - 0.42) * 0.7
  );
  const stylized = stylizedScore >= 0.5;
  const confidence = stylized
    ? 0.55 + (stylizedScore - 0.5) * 0.8
    : 0.55 + (0.5 - stylizedScore) * 0.8;
  return {
    kind: stylized ? "stylized" : "photograph",
    confidence: clamp01(confidence),
    method: "automatic",
    realismStrength: stylized ? 0.42 + stylizedScore * 0.25 : 0,
    notes: [
      stylized
        ? "Flat-color and edge patterns suggest illustration; realism normalization is enabled."
        : "Image sampling suggests a photograph; measured proportions are preserved.",
      `Edge density ${edgeDensity.toFixed(3)}, palette score ${paletteCompression.toFixed(3)}.`
    ]
  };
}
