export const STT_MODELS = {
  "moonshine-tiny": { id: "onnx-community/moonshine-tiny-ONNX", label: "Moonshine Tiny (English)", kind: "moonshine" },
  "whisper-tiny.en": { id: "onnx-community/whisper-tiny.en", label: "Whisper Tiny English", kind: "whisper-en" },
  "whisper-tiny": { id: "onnx-community/whisper-tiny", label: "Whisper Tiny (multilingual)", kind: "whisper" },
  "whisper-base": { id: "onnx-community/whisper-base", label: "Whisper Base (multilingual)", kind: "whisper" },
} as const;

export type SttModel = keyof typeof STT_MODELS;

export function resolveSttModel(value = "whisper-tiny.en"): SttModel {
  const input = value.trim();
  if (input in STT_MODELS) return input as SttModel;
  // Original weights aren't browser-ready; use the ONNX conversion.
  if (input === "openai/whisper-tiny.en") return "whisper-tiny.en";
  const match = Object.entries(STT_MODELS).find(([, model]) => model.id === input);
  if (match) return match[0] as SttModel;
  throw new Error(`Unsupported STT_MODEL. Choose: ${Object.keys(STT_MODELS).join(", ")}`);
}
