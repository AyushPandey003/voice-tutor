<div align="center">

# 📚 Revision Agent

**Upload a Markdown lesson. Get a coach that summarizes, quizzes, explains and finds your weak spots. Type or talk.**

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![Markdown](https://img.shields.io/badge/Input-Markdown-083FA1?logo=markdown&logoColor=white)
![Whisper](https://img.shields.io/badge/STT-Whisper%20(on--device)-10A37F)
![Speech](https://img.shields.io/badge/TTS-Browser%20speech-FF6F61)
![WebGPU](https://img.shields.io/badge/WebGPU-%2B%20WASM%20fallback-005A9C)
![Voice cost](https://img.shields.io/badge/STT%2FTTS%20cost-%240-brightgreen)

</div>

---

## ✨ What it does

| | |
|---|---|
| 📄 **Upload** | Drop a `.md` (or `.txt`) lesson; it stays in your browser's localStorage |
| 🧭 **Outline** | Headings become a sidebar; click one to revise just that section |
| 🤖 **Coach** | Summary, one-at-a-time quiz with grading, flashcards, simple explanations, weak-spot review |
| 🎙️ **Optional voice** | On-device Whisper + browser speech playback; confidence-gated hands-free interruption |
| 💸 **Cheap** | Gemini Flash-Lite; replies capped, history trimmed to 12 messages |
| 🐳 **Docker** | `docker compose up --build` |

## 🚀 Quick start (Docker)

```bash
cp .env.example .env      # set GEMINI_API_KEY
docker compose up --build
```

Open **http://localhost:3000**, click **Try the sample lesson** or drop your own `.md`.

## 🧑‍💻 Quick start (no Docker)

```bash
pnpm install --ignore-scripts
cp .env.example .env.local  # set GEMINI_API_KEY
pnpm dev
```

## 🔧 Configuration

| Variable | Example | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `...` | Required; server-side only |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Optional; defaults to Gemini 2.5 Flash-Lite |

### Bring your own key (BYOK)

Set **`BYOK_ENABLED=true`** in the deployment environment to require every user to enter their own Gemini API key. Users cannot disable this policy; the API enforces it with no server-key fallback. The key is held in page memory only, sent through `/api/tutor` to Gemini, and cleared on refresh.

With **`BYOK_ENABLED=false`** (default), the key input is hidden and all requests use the server's `GEMINI_API_KEY`. Public deployments should still protect server-key requests with authentication/rate limiting. Restart/redeploy after changing the flag.

## 🏗️ How it works

```
lesson.md ─► system prompt (grounded coach rules + lesson text)
                │
 you (text/voice) ─► /api/tutor ─► LLM ─► streamed reply ─► chat (+ browser voice)
```

The lesson is sent with every request (first 40,000 characters). To cut cost on long lessons, use your provider's prompt caching.

## ⚠️ Good to know

- 📏 Lessons over about 40k characters are truncated. Chunking by section is the natural next step.
- 🧠 The coach tracks weak spots from the conversation only; nothing is stored server-side.
- 🌐 Voice needs HTTPS or localhost for mic access, and downloads models from Hugging Face on first use.
- 🎧 Use headphones with voice on to prevent speaker echo from triggering interruption.
- 🎙️ The mic stays active: speech probability must exceed 0.85 for at least 450 ms before interruption; 650 ms of silence ends your turn. Echo cancellation and noise suppression are requested.
- 🔊 Browser speech playback replaces local Kokoro inference for lower startup/playback latency; voice quality and online/offline operation depend on your browser.

## 📁 Layout

```
app/page.tsx                    # upload screen + revision UI
app/api/tutor/route.ts          # streams LLM text
lib/voice-tutor/revisionPrompt.ts   # coach prompt + outline parser
lib/voice-tutor/useVoiceTutor.ts    # text chat + optional voice hook
lib/voice-tutor/*.worker.ts         # Whisper / Kokoro workers
public/sample-lesson.md
```
