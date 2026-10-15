import { env, pipeline } from "@huggingface/transformers";
import { STT_MODELS, resolveSttModel, type SttModel } from "./sttConfig";

// Run inside our dedicated worker; avoid nested Emscripten pthread workers.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = new URL("/vad/", self.location.origin).href;
}

let asr: any = null;
let selected: SttModel = "whisper-tiny.en";
let language = "auto";

async function load(device: "webgpu" | "wasm", model: string, requestedLanguage: string) {
  selected = resolveSttModel(model);
  language = requestedLanguage || "auto";
  asr = await (pipeline as any)("automatic-speech-recognition", STT_MODELS[selected].id, {
    device,
    dtype: device === "webgpu" ? "fp32" : "q8",
    progress_callback: (p: any) => self.postMessage({ type: "progress", model: "stt", p }),
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, audio, device, model, language: requestedLanguage } = e.data;
  try {
    if (type === "init") {
      await load(device, model, requestedLanguage);
      self.postMessage({ type: "ready" });
    } else if (type === "transcribe") {
      const kind = STT_MODELS[selected].kind;
      // Moonshine and English-only Whisper don't accept multilingual task tokens.
      const options = kind === "whisper"
        ? { task: "transcribe", ...(language !== "auto" ? { language } : {}), chunk_length_s: 30, stride_length_s: 5 }
        : kind === "whisper-en" ? { chunk_length_s: 30, stride_length_s: 5 } : {};
      const out = await asr(audio as Float32Array, options);
      self.postMessage({ type: "result", id, text: (out.text as string).trim() });
    }
  } catch (err: any) {
    self.postMessage({ type: "error", id, message: String(err?.message ?? err) });
  }
};
