"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { STT_MODELS, type SttModel } from "./sttConfig";

export type Status = "idle" | "loading" | "listening" | "recording" | "transcribing" | "thinking" | "speaking";
export type Msg = { role: "user" | "assistant"; content: string };

type Opts = {
  endpoint?: string;     // Next.js route that streams plain text
  systemPrompt?: string; // read fresh on every request
  voice?: string;
  sttModel?: SttModel;
  sttLanguage?: string;
  maxTokens?: number;
  byok?: boolean;
  apiKey?: string;
};

/** Text chat with hands-free voice and confidence-gated interruption. */
export function useVoiceTutor({ endpoint = "/api/tutor", systemPrompt, voice, sttModel = "whisper-tiny.en", sttLanguage = "auto", maxTokens, byok = false, apiKey = "" }: Opts = {}) {
  const [status, setStatus] = useState<Status>("idle"); // voice state
  const [busy, setBusy] = useState(false);              // LLM reply in flight
  const [messages, setMessages] = useState<Msg[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState("");
  const startup = useRef<AbortController | undefined>(undefined);

  const stt = useRef<Worker | undefined>(undefined);
  const utterances = useRef(new Map<SpeechSynthesisUtterance, () => void>());
  const vad = useRef<any>(undefined);
  const userSpeaking = useRef(false);
  const speechPending = useRef(0);
  const ctx = useRef<AudioContext | undefined>(undefined);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const nextStart = useRef(0);
  const abort = useRef<AbortController | undefined>(undefined);
  const gen = useRef(0); // bumps on barge-in / reset to drop stale work
  const history = useRef<Msg[]>([]);
  const pending = useRef(new Map<number, (v: any) => void>());
  const reqId = useRef(0);
  const statusRef = useRef<Status>("idle");
  const voiceActive = useRef(false);
  const speakQueue = useRef<Promise<void>>(Promise.resolve());
  const promptRef = useRef(systemPrompt);
  promptRef.current = systemPrompt;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const credentials = useRef({ byok, apiKey });
  credentials.current = { byok, apiKey };

  const set = (s: Status) => { statusRef.current = s; setStatus(s); };

  const call = (w: Worker, msg: any) =>
    new Promise<any>((resolve, reject) => {
      const id = ++reqId.current;
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error("Speech recognition timed out. Please try again."));
      }, 90_000);
      pending.current.set(id, (r) => {
        clearTimeout(timer);
        if (r.type === "error") reject(new Error(r.message));
        else resolve(r);
      });
      try { w.postMessage({ ...msg, id }); }
      catch (e) { clearTimeout(timer); pending.current.delete(id); reject(e); }
    });

  const stopPlayback = () => {
    sources.current.forEach((s) => { try { s.stop(); } catch {} });
    sources.current = [];
    nextStart.current = 0;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    utterances.current.forEach((finish) => finish());
    utterances.current.clear();
  };

  const settleVoice = (myGen: number) => {
    if (myGen === gen.current && voiceActive.current && !sources.current.length && !speechPending.current && statusRef.current === "speaking") set("listening");
  };

  const enqueueSpeech = (sentence: string, myGen: number) => {
    speechPending.current++;
    speakQueue.current = speakQueue.current.then(async () => {
      if (myGen !== gen.current || !voiceActive.current || !sentence.trim()) return;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(sentence.replace(/[*#`]/g, ""));
        utterance.lang = "en-US";
        const voices = window.speechSynthesis.getVoices();
        const selected = voices.find((v) => voiceRef.current ? v.voiceURI === voiceRef.current : v.lang.startsWith("en") && /Natural|Online|Google/.test(v.name))
          ?? voices.find((v) => v.lang.startsWith("en"));
        if (selected) utterance.voice = selected;
        const finish = () => { utterances.current.delete(utterance); resolve(); };
        utterances.current.set(utterance, finish);
        utterance.onend = finish;
        utterance.onerror = (e) => {
          if (myGen === gen.current && e.error !== "canceled" && e.error !== "interrupted") setError(`Voice playback failed: ${e.error}`);
          finish();
        };
        set("speaking");
        window.speechSynthesis.speak(utterance);
      });
    }).catch((e) => {
      if (myGen === gen.current) setError(String(e.message ?? e));
    }).finally(() => {
      speechPending.current--;
      settleVoice(myGen);
    });
  };

  const send = useCallback(async (userText: string) => {
    const text = userText.trim();
    if (!text || statusRef.current === "recording" || statusRef.current === "transcribing") return;
    const auth = credentials.current;
    if (auth.byok && !auth.apiKey.trim()) {
      setError("This app requires your Gemini API key. Enter it before chatting.");
      return;
    }
    const myGen = ++gen.current;
    abort.current?.abort();
    stopPlayback();
    abort.current = new AbortController();
    setError(null);
    history.current.push({ role: "user", content: text });
    setMessages([...history.current, { role: "assistant", content: "" }]);
    setBusy(true);
    if (voiceActive.current) set("thinking");

    let full = "", buffer = "";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.current, systemPrompt: promptRef.current, maxTokens, ...(auth.byok ? { apiKey: auth.apiKey.trim() } : {}) }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (myGen !== gen.current) {
          if (full.trim()) history.current.push({ role: "assistant", content: full });
          return;
        }
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        full += chunk; buffer += chunk;
        setMessages([...history.current, { role: "assistant", content: full }]);
        if (voiceActive.current) {
          let m: RegExpMatchArray | null;
          while ((m = buffer.match(/^(.+?[.!?]+["')\]]*)\s+/s))) {
            enqueueSpeech(m[1], myGen);
            buffer = buffer.slice(m[0].length);
          }
        }
      }
      if (voiceActive.current && buffer.trim()) enqueueSpeech(buffer, myGen);
      history.current.push({ role: "assistant", content: full });
      setMessages([...history.current]);
      speakQueue.current.then(() => {
        if (myGen === gen.current && voiceActive.current && !sources.current.length) set("listening");
      });
    } catch (e: any) {
      if (myGen !== gen.current) {
        if (full.trim()) history.current.push({ role: "assistant", content: full });
        return;
      }
      if (full.trim()) history.current.push({ role: "assistant", content: full });
      setMessages([...history.current]);
      if (e.name !== "AbortError") setError(String(e.message ?? e));
    } finally {
      if (myGen === gen.current) {
        setBusy(false);
        if (voiceActive.current && !sources.current.length && !speechPending.current) set("listening");
      }
    }
  }, [endpoint, maxTokens]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle") return;
    setError(null);
    setProgress(0);
    setLoadingDetail(`Loading ${STT_MODELS[sttModel].label} (first use downloads model files)…`);
    set("loading");
    const controller = new AbortController();
    startup.current = controller;
    // Quantized WASM models avoid large fp32 downloads and unreliable GPU adapters.
    const device = "wasm";

    const mk = (w: Worker) => {
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === "progress") {
          if (d.p?.status === "progress") {
            setProgress(Math.round(d.p.progress ?? 0));
            setLoadingDetail(`${d.model === "stt" ? "Speech recognition" : "Voice synthesis"}: ${d.p.file ?? "model"} (${Math.round(d.p.progress ?? 0)}%)`);
          }
        } else if (d.id && pending.current.has(d.id)) {
          pending.current.get(d.id)!(d); pending.current.delete(d.id);
        }
      };
      return w;
    };
    const ready = (w: Worker) => new Promise<void>((res, rej) => {
      const cleanup = () => {
        clearTimeout(timer);
        w.removeEventListener("message", h);
        w.removeEventListener("error", failed);
        controller.signal.removeEventListener("abort", cancelled);
      };
      const fail = (message: string) => { cleanup(); rej(new Error(message)); };
      const h = (e: MessageEvent) => {
        if (e.data.type === "ready") { cleanup(); res(); }
        if (e.data.type === "error") fail(e.data.message);
      };
      const failed = (e: ErrorEvent) => fail(e.message || "Speech worker failed to load. Please reload and try again.");
      const cancelled = () => { cleanup(); rej(new DOMException("Voice startup cancelled", "AbortError")); };
      const timer = setTimeout(() => fail("Speech model loading timed out. Check your connection to Hugging Face and try again."), 300_000);
      w.addEventListener("message", h);
      w.addEventListener("error", failed);
      controller.signal.addEventListener("abort", cancelled, { once: true });
      w.postMessage({ type: "init", device, model: sttModel, language: sttLanguage });
    });
    try {
      ctx.current = new AudioContext();
      await ctx.current.resume();
      // Webpack requires new Worker(new URL(...)) directly to compile worker code.
      stt.current = mk(new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" }));
      if (!window.speechSynthesis) throw new Error("This browser does not support voice playback.");
      await ready(stt.current);
      if (controller.signal.aborted) return;
      setLoadingDetail("Starting microphone with echo cancellation�");
      const { MicVAD } = await import("@ricky0123/vad-web");
      if (controller.signal.aborted) return;
      const mic = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        startOnLoad: false,
        // Wait for sustained confident speech; ignore brief noises/coughs.
        positiveSpeechThreshold: 0.85,
        negativeSpeechThreshold: 0.55,
        minSpeechMs: 450,
        redemptionMs: 650,
        preSpeechPadMs: 300,
        ortConfig: (ort: any) => {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
        },
        getStream: () => navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          channelCount: 1,
        } }),
        onSpeechRealStart: () => {
          if (!voiceActive.current) return;
          userSpeaking.current = true;
          gen.current++;
          abort.current?.abort();
          stopPlayback();
          setBusy(false);
          set("recording");
        },
        onSpeechEnd: async (audio: Float32Array) => {
          if (!voiceActive.current || !userSpeaking.current) return;
          userSpeaking.current = false;
          const myGen = gen.current;
          set("transcribing");
          try {
            const result = await call(stt.current!, { type: "transcribe", audio });
            if (myGen !== gen.current || !voiceActive.current) return;
            set("listening");
            if (result.text?.trim()) await send(result.text);
          } catch (e: any) {
            if (myGen !== gen.current || !voiceActive.current) return;
            setError(String(e.message ?? e));
            set("listening");
          }
        },
      });
      if (controller.signal.aborted) { await mic.destroy(); return; }
      vad.current = mic;
      voiceActive.current = true;
      await mic.start();
      if (controller.signal.aborted) return;
      setLoadingDetail("");
      set("listening");
    } catch (e: any) {
      if (!controller.signal.aborted) {
        setError(String(e.message ?? e));
        teardownVoice();
      }
    }
  }, [send, sttModel, sttLanguage]);

  const teardownVoice = () => {
    startup.current?.abort(); startup.current = undefined;
    setLoadingDetail("");
    setProgress(0);
    voiceActive.current = false;
    gen.current++;
    abort.current?.abort();
    stopPlayback();
    userSpeaking.current = false;
    pending.current.forEach((resolve) => resolve({ type: "error", message: "Voice stopped" }));
    pending.current.clear();
    vad.current?.destroy().catch(() => {}); vad.current = undefined;
    stt.current?.terminate(); stt.current = undefined;

    ctx.current?.close().catch(() => {}); ctx.current = undefined;
    setBusy(false);
    set("idle");
  };

  const stop = useCallback(() => teardownVoice(), []);

  const reset = useCallback(() => {
    gen.current++;
    abort.current?.abort();
    stopPlayback();
    userSpeaking.current = false;
    history.current = [];
    setMessages([]);
    setBusy(false);
    setError(null);
    if (voiceActive.current) set("listening");
  }, []);

  useEffect(() => () => teardownVoice(), []);

  return { status, busy, messages, progress, loadingDetail, error, start, stop, send, reset };
}
