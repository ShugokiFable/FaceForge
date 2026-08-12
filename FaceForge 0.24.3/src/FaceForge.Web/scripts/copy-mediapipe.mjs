import { cp, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "node_modules", "@mediapipe", "tasks-vision");
const outputRoot = resolve(root, "public", "mediapipe");

await mkdir(resolve(outputRoot, "wasm"), { recursive: true });
await cp(resolve(packageRoot, "wasm"), resolve(outputRoot, "wasm"), {
  recursive: true,
  force: true
});

for (const candidate of ["LICENSE", "README.md"]) {
  try {
    await copyFile(resolve(packageRoot, candidate), resolve(outputRoot, candidate));
  } catch {
    // Package layouts vary; the release manifest records the pinned package and license.
  }
}
