// Copies Silero VAD + onnxruntime-web runtime files into /public/vad
import { cpSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "public", "vad");
mkdirSync(out, { recursive: true });

const vadDist = join("node_modules", "@ricky0123", "vad-web", "dist");
const ortDist = join("node_modules", "onnxruntime-web", "dist");

let n = 0;
if (existsSync(vadDist)) {
  for (const f of readdirSync(vadDist)) {
    if (f.endsWith(".onnx") || f.startsWith("vad.worklet")) { cpSync(join(vadDist, f), join(out, f)); n++; }
  }
}
if (existsSync(ortDist)) {
  for (const f of readdirSync(ortDist)) {
    if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) { cpSync(join(ortDist, f), join(out, f)); n++; }
  }
}
console.log(`[revision-agent] copied ${n} VAD/ORT assets to public/vad`);
