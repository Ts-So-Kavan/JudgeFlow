export const runtime = "edge";

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    arguments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          side: { type: "string" },
          claim: { type: "string" },
          support: { type: "string" },
          status: { type: "string", enum: ["introduced", "contested", "extended", "possibly_unanswered"] },
          transcriptQuote: { type: "string" },
        },
        required: ["id", "side", "claim", "support", "status", "transcriptQuote"],
      },
    },
    responses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          side: { type: "string" },
          target: { type: "string" },
          response: { type: "string" },
          status: { type: "string", enum: ["answered", "partial", "possibly_unanswered"] },
        },
        required: ["side", "target", "response", "status"],
      },
    },
    votingIssues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          comparison: { type: "string" },
          verify: { type: "string" },
        },
        required: ["title", "comparison", "verify"],
      },
    },
    newArgumentAlerts: { type: "array", items: { type: "string" } },
    feedback: {
      type: "object",
      additionalProperties: false,
      properties: {
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
      },
      required: ["strengths", "improvements"],
    },
  },
  required: ["summary", "arguments", "responses", "votingIssues", "newArgumentAlerts", "feedback"],
} as const;

function localAnalysis(body: Record<string, unknown>) {
  const setup = body.setup as { teamA?: string; teamB?: string } | undefined;
  const speeches = (body.speeches as Array<{ side?: string; label?: string; transcript?: string }> | undefined) || [];
  const makeArgument = (side: "A" | "B", name: string) => {
    const text = speeches.filter((speech) => speech.side === side).map((speech) => speech.transcript || "").join(" ").trim();
    const first = text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 240) || "No transcribed claim is available yet.";
    const transcriptCount = speeches.filter((speech) => speech.side === side && speech.transcript).length;
    return {
      id: `local-${side.toLowerCase()}`,
      side: name,
      claim: first,
      support: `${transcriptCount} transcribed ${transcriptCount === 1 ? "speech" : "speeches"} available for local review.`,
      status: "introduced",
      transcriptQuote: first,
    };
  };
  return {
    summary: "Local review grouped the available transcript. Configure an OpenAI API key for response matching and deeper comparative analysis.",
    arguments: [makeArgument("A", setup?.teamA || "Side A"), makeArgument("B", setup?.teamB || "Side B")],
    responses: [],
    votingIssues: [{ title: "Comparative warrant", comparison: "Compare which side explains its mechanism and impact with the clearest warranted link.", verify: "Check the original transcript before treating an omission as a dropped argument." }],
    newArgumentAlerts: [],
    feedback: { strengths: ["The round has an editable record for verification."], improvements: ["Add an API key for tailored argument matching and feedback."] },
    source: "local",
  };
}

function extractOutputText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid round data." }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json(localAnalysis(body));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_ANALYSIS_MODEL || "gpt-6-astra",
      store: false,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "You organize a high-school debate flow for a human judge. Analyze only arguments actually present in the provided transcript. Never decide the winner. Never invent evidence, warrants, concessions, or speaker attribution. Use short verbatim transcript excerpts as traceability anchors. Treat a possible dropped argument as uncertain unless the transcript clearly shows it. Flag possible new arguments in PF summary/final focus or LD NR/2AR, but instruct the judge to verify. Give balanced, specific strengths and improvements.",
            },
          ],
        },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(body) }] },
      ],
      text: { format: { type: "json_schema", name: "debate_flow", strict: true, schema: analysisSchema } },
    }),
  });
  const data = await response.json().catch(() => ({})) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
  if (!response.ok) return Response.json({ error: data.error?.message || "OpenAI analysis failed." }, { status: response.status });
  const text = extractOutputText(data);
  if (!text) return Response.json({ error: "OpenAI returned no structured analysis." }, { status: 502 });
  return Response.json({ ...JSON.parse(text), source: "openai" });
}
