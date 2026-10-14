import { env, pipeline } from "@huggingface/transformers";

// Run inside our dedicated worker; avoid nested Emscripten pthread workers.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = new URL("/vad/", self.location.origin).href;
}

let asr: any = null;

async function load(device: "webgpu" | "wasm") {
  asr = await (pipeline as any)("automatic-speech-recognition", "onnx-community/whisper-base", {
    device,
    dtype: device === "webgpu" ? "fp32" : "q8",
    progress_callback: (p: any) => self.postMessage({ type: "progress", model: "stt", p }),
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, audio, device } = e.data;
  try {
    if (type === "init") {
      await load(device);
      self.postMessage({ type: "ready" });
    } else if (type === "transcribe") {
      const out = await asr(audio as Float32Array, { language: "en", task: "transcribe" });
      self.postMessage({ type: "result", id, text: (out.text as string).trim() });
    }
  } catch (err: any) {
    self.postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
};
