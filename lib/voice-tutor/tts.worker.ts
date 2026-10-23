import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = new URL("/vad/", self.location.origin).href;
}

let tts: KokoroTTS | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, id, text, voice, device } = e.data;
  try {
    if (type === "init") {
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback: (p: any) => self.postMessage({ type: "progress", model: "tts", p }),
      });
      // Load the chosen voice and initialize inference before enabling the mic.
      self.postMessage({ type: "progress", model: "tts", p: { status: "progress", file: "Warming up Kokoro voice…", progress: 100 } });
      await tts.generate("Ready.", { voice: voice ?? "af_heart" });
      self.postMessage({ type: "ready" });
    } else if (type === "speak") {
      const out: any = await tts!.generate(text, { voice: voice ?? "af_heart" });
      const audio = out.audio as Float32Array;
      self.postMessage({ type: "result", id, audio, sampleRate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
};
