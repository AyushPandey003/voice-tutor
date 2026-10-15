"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STT_MODELS, type SttModel } from "@/lib/voice-tutor/sttConfig";
import { voiceGroup } from "@/lib/voice-tutor/browserVoices";
import { useVoiceTutor } from "@/lib/voice-tutor/useVoiceTutor";
import { KICKOFF, MAX_LESSON_CHARS, buildRevisionPrompt, extractOutline } from "@/lib/voice-tutor/revisionPrompt";

type Lesson = { name: string; text: string };
const STORE = "revision-agent:lesson";
const MAX_FILE = 300_000; // bytes

const ACTIONS: { label: string; prompt: string }[] = [
  { label: "📝 Summarize", prompt: "Summarize the lesson in a few short points." },
  { label: "❓ Quiz me", prompt: "Quiz me on the lesson, one question at a time." },
  { label: "🗂️ Flashcards", prompt: "Give me 5 flashcards (term and meaning) from the lesson." },
  { label: "💡 Explain simply", prompt: "Pick the hardest idea in the lesson and explain it simply with an example." },
  { label: "🎯 Weak spots", prompt: "Based on my answers so far, what should I revise again? If I haven't answered anything, start a quick quiz." },
];

export default function TutorPage({ byokRequired }: { byokRequired: boolean }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sttModel, setSttModel] = useState<SttModel>("whisper-tiny.en");
  const [sttLanguage, setSttLanguage] = useState("auto");
  const [voice, setVoice] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  const kick = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const systemPrompt = useMemo(
    () => (lesson ? buildRevisionPrompt(lesson.text, lesson.name) : undefined),
    [lesson]
  );
  const { status, busy, messages, progress, loadingDetail, error, start, stop, send, reset } = useVoiceTutor({
    systemPrompt,
    sttModel,
    sttLanguage,
    voice,
    maxTokens: 450,
    byok: byokRequired,
    apiKey,
  });
  const outline = useMemo(() => (lesson ? extractOutline(lesson.text) : []), [lesson]);
  const voiceOn = status !== "idle";
  const inputBusy = busy || status === "recording" || status === "transcribing";

  // restore last lesson (no auto-kickoff, so refresh doesn't spend tokens)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setLesson(JSON.parse(raw));
    } catch {}
  }, []);

  // auto-kickoff only right after a fresh upload
  useEffect(() => {
    if (lesson && kick.current) { kick.current = false; send(KICKOFF); }
  }, [lesson, send]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const loadLesson = useCallback((name: string, text: string) => {
    const clean = text.replace(/\r\n/g, "\n").trim();
    if (!clean) { setNotice("That file looks empty."); return; }
    setNotice(clean.length > MAX_LESSON_CHARS
      ? `Lesson is long, so only the first ${MAX_LESSON_CHARS.toLocaleString()} characters are used.`
      : null);
    reset();
    kick.current = true;
    const l = { name, text: clean };
    setLesson(l);
    try { localStorage.setItem(STORE, JSON.stringify(l)); } catch {}
  }, [reset]);

  const readFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE) { setNotice("File is too large (max about 300 KB)."); return; }
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setNotice("Please upload a .md (or .txt) file."); return; }
    loadLesson(file.name, await file.text());
  }, [loadLesson]);

  const useSample = async () => {
    const r = await fetch("/sample-lesson.md");
    loadLesson("sample-lesson.md", await r.text());
  };

  const clearLesson = () => {
    stop(); reset(); setLesson(null); setNotice(null);
    try { localStorage.removeItem(STORE); } catch {}
  };

  const submit = () => {
    if (!input.trim() || inputBusy) return;
    send(input); setInput("");
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); },
  };

  const keySettings = byokRequired ? (
    <section className="card" style={{ marginBottom: 16, padding: 16 }} aria-label="Gemini API key settings">
      <strong>Your Gemini API key is required</strong>
      <>
        <input type="password" aria-label="Gemini API key" placeholder="Paste your Gemini API key"
               value={apiKey} maxLength={256} autoComplete="off" spellCheck={false} disabled={inputBusy}
               onChange={(e) => setApiKey(e.target.value)} style={{ width: "100%", marginTop: 12 }} />
        <p className="sub">Used only for your requests. Sent through this app's server to Gemini; not saved in browser storage. Cleared on refresh.</p>
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a Gemini API key</a>
      </>
    </section>
  ) : null;

  const voiceSettings = (
    <section className="card" style={{ marginBottom: 16, padding: 16 }} aria-label="Speech settings">
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <label>Speech recognition<br />
          <select value={sttModel} disabled={voiceOn} onChange={(e) => setSttModel(e.target.value as SttModel)}>
            {Object.entries(STT_MODELS).map(([key, model]) => <option key={key} value={key}>{model.label}</option>)}
          </select>
        </label>
        {STT_MODELS[sttModel].kind === "whisper" && <label>Recognition language<br />
          <select value={sttLanguage} disabled={voiceOn} onChange={(e) => setSttLanguage(e.target.value)}>
            <option value="auto">Auto-detect</option>
            <option value="english">English</option><option value="hindi">Hindi</option>
            <option value="spanish">Spanish</option><option value="french">French</option>
            <option value="german">German</option><option value="japanese">Japanese</option>
          </select>
        </label>}
        <label>AI speaking voice<br />
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            <option value="">Automatic (English)</option>
            {(["Female", "Male", "Other / unspecified"] as const).map((group) => (
              <optgroup key={group} label={group}>
                {voices.filter((v) => voiceGroup(v.name) === group).map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.lang}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <p className="sub">{STT_MODELS[sttModel].id}. {voiceOn ? "Turn Voice off to change recognition models." : "Each model downloads once, then is cached by your browser."} Speaking voices depend on your browser/OS; gender groups are inferred from known names. Voice changes apply to the next sentence.</p>
    </section>
  );

  if (!lesson) {
    return (
      <main>
        <h1>📚 Revision Agent</h1>
        {keySettings}
        {voiceSettings}
        <p className="sub">Upload a lesson in Markdown and revise it with a coach that quizzes you, explains, and finds your weak spots.</p>
        <div className={`drop card ${drag ? "over" : ""}`} {...dropProps} onClick={() => fileRef.current?.click()}>
          <div className="big">⬆️</div>
          <strong>Drop your .md lesson here</strong>
          <span className="sub">or click to choose a file</span>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden
                 onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
        <div className="row"><button className="ghost" onClick={useSample}>Try the sample lesson</button></div>
        {notice && <div className="err">{notice}</div>}
      </main>
    );
  }

  return (
    <main className="wide">
      {keySettings}
      {voiceSettings}
      <div className="layout" {...dropProps}>
        <aside className="card side">
          <div className="side-head">
            <strong title={lesson.name}>📄 {lesson.name}</strong>
            <button className="ghost sm" onClick={clearLesson}>Replace</button>
          </div>
          {notice && <div className="err">{notice}</div>}
          <div className="sub">Click a section to revise it</div>
          <nav className="outline">
            {outline.length === 0 && <span className="sub">No headings found in this file.</span>}
            {outline.map((o, i) => (
              <button key={i} className="o" style={{ paddingLeft: 8 + (o.level - 1) * 14 }} disabled={inputBusy}
                      onClick={() => send(`Let's revise this section: "${o.title}". Start by quizzing me on it.`)}>
                {o.title}
              </button>
            ))}
          </nav>
        </aside>

        <section className="card chat">
          <div className="bar">
            <div className="chips">
              {ACTIONS.map((a) => (
                <button key={a.label} className="chip" disabled={inputBusy} onClick={() => send(a.prompt)}>{a.label}</button>
              ))}
            </div>
          </div>

          {status === "loading" && <div className="progress"><div style={{ width: `${progress}%` }} /></div>}

          <div className="log" ref={logRef}>
            {messages.length === 0 && <span className="sub">Starting…</span>}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>{m.content || "…"}</div>
            ))}
          </div>

          {error && <div className="err">{error}</div>}

          <div className="composer">
            <textarea value={input} rows={1} placeholder="Answer or ask something…"
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <button onClick={submit} disabled={inputBusy || !input.trim()}>Send</button>
            {!voiceOn
              ? <button className="ghost" onClick={start} title="Enable hands-free voice with confident-speech interruption">🎙️ Voice</button>
              : <button className="ghost" onClick={stop}>⏹ Voice</button>}
            <button className="ghost" onClick={reset} title="Clear the conversation">↺</button>
          </div>
          <div className="hint">
            {voiceOn ? <><span className="pill" data-s={status}>{status === "listening" ? "Listening — speak naturally" : status === "recording" ? "Hearing you — pause to send" : status}</span>{loadingDetail && <span role="status"> {loadingDetail}</span>}</> : "Hands-free voice: sustained speech interrupts; a short silence sends your turn. Headphones reduce echo."}
          </div>
        </section>
      </div>
    </main>
  );
}
