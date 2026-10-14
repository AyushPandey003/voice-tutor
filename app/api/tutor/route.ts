// Gemini's OpenAI-compatible streaming endpoint.
// Env (read at runtime): GEMINI_API_KEY, optional GEMINI_MODEL
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.slice(0, 60000) : undefined;
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 300, 50), 1000);

  // Deployment policy cannot be overridden by the client.
  const byok = process.env.BYOK_ENABLED === "true";
  const userKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (byok && (!userKey || userKey.length > 256 || /\s/.test(userKey))) {
    return new Response("This deployment requires your own valid Gemini API key.", { status: 400 });
  }
  const apiKey = byok ? userKey : process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("Server key is not configured. Contact the app administrator.", { status: 503 });
  }

  const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      stream: true,
      max_tokens: maxTokens, // short replies; also caps cost
      messages: [
        {
          role: "system",
          content:
            systemPrompt ??
            "You are a friendly voice tutor. Reply in 1-3 short spoken sentences. No markdown, no lists, no emojis.",
        },
        ...messages.slice(-12), // trim history to control token cost
      ],
    }),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    // Don't forward provider error payloads that might expose request details.
    const message = upstream.status === 401 || upstream.status === 403
      ? "Gemini rejected the API key. Check your key and permissions."
      : upstream.status === 429
        ? "Gemini quota exceeded. Check your key's quota or try again later."
        : "Gemini request failed. Please try again.";
    return new Response(message, { status: upstream.ok ? 502 : upstream.status });
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  let carry = "";
  const out = new ReadableStream({
    async start(ctrl) {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += dec.decode(value, { stream: true });
          const lines = carry.split("\n");
          carry = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta?.content;
              if (delta) ctrl.enqueue(enc.encode(delta));
            } catch {}
          }
        }
        ctrl.close();
      } catch {
        ctrl.close();
      }
    },
    cancel() { upstream.body?.cancel(); },
  });
  return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
