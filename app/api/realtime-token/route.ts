export const runtime = "edge";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Live transcription needs an OPENAI_API_KEY. You can still type notes or use Simulate." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({})) as {
    source?: "tab" | "microphone";
    event?: "PF" | "LD";
    resolution?: string;
  };

  const prompt = [
    "High school speech and debate round.",
    body.event === "LD" ? "Lincoln-Douglas debate." : "Public Forum debate.",
    "Preserve debate terms, acronyms, numbers, evidence citations, and speaker phrasing.",
    body.resolution ? `Resolution: ${body.resolution.slice(0, 600)}` : "",
  ].filter(Boolean).join(" ");

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "judgeflow-local-judge",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            noise_reduction: body.source === "microphone" ? { type: "far_field" } : null,
            transcription: {
              model: "gpt-live-transcribe",
              languages: ["en"],
              prompt,
              keywords: ["contention", "rebuttal", "frontline", "impact", "weighing", "crossfire", "framework"],
            },
            turn_detection: null,
          },
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({ error: { message: "OpenAI returned an unreadable response." } })) as {
    value?: string;
    expires_at?: number;
    error?: { message?: string };
  };
  if (!response.ok) {
    return Response.json({ error: data.error?.message || "Could not create a transcription session." }, { status: response.status });
  }

  return Response.json({ value: data.value, expiresAt: data.expires_at }, { headers: { "Cache-Control": "no-store" } });
}
