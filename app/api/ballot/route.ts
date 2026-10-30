export const runtime = "edge";

const ballotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rfd: { type: "string" },
    oralDisclosure: { type: "string" },
    feedback: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          strengths: { type: "string" },
          improvements: { type: "string" },
        },
        required: ["speaker", "strengths", "improvements"],
      },
    },
  },
  required: ["rfd", "oralDisclosure", "feedback"],
} as const;

function extractOutputText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function localBallot(body: Record<string, unknown>) {
  const setup = body.setup as { teamA?: string; teamB?: string; speakersA?: string[]; speakersB?: string[] } | undefined;
  const winner = body.winner === "A" ? setup?.teamA : setup?.teamB;
  const issues = body.selectedIssues as Array<{ title?: string; comparison?: string }> | undefined;
  const issue = issues?.[0];
  const speakers = [...(setup?.speakersA || []), ...(setup?.speakersB || [])];
  return {
    rfd: `I vote for ${winner || "the selected side"}. ${issue ? `The decisive issue is ${issue.title?.toLowerCase()}. ${issue.comparison}` : "The deciding factor was the comparative strength of the arguments extended through the final speeches."} I evaluated the logic of the arguments presented and used speaking quality only for speaker points.`,
    oralDisclosure: `My decision is for ${winner || "the selected side"}. I will begin with the decisive argument comparison, then offer one strength and one area for improvement for each debater.`,
    feedback: speakers.map((speaker) => ({ speaker, strengths: "You contributed to a clear central clash and maintained an identifiable position through the round.", improvements: "Make the final comparison more explicit and connect each extension to a warranted impact." })),
    source: "local",
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid ballot data." }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json(localBallot(body));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_ANALYSIS_MODEL || "gpt-6-astra",
      store: false,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: "Draft a substantial high-school debate ballot from the human judge's explicit winner and selected voting issues. Never change or second-guess the winner. Explain the decisive argument logic, not speaking style. Give every listed speaker one specific strength and one constructive improvement. Do not invent evidence or facts beyond the supplied transcript and analysis. Keep the oral disclosure concise. Do not mention AI." }],
        },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(body) }] },
      ],
      text: { format: { type: "json_schema", name: "debate_ballot", strict: true, schema: ballotSchema } },
    }),
  });
  const data = await response.json().catch(() => ({})) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
  if (!response.ok) return Response.json({ error: data.error?.message || "OpenAI ballot drafting failed." }, { status: response.status });
  const text = extractOutputText(data);
  if (!text) return Response.json({ error: "OpenAI returned no ballot draft." }, { status: 502 });
  return Response.json({ ...JSON.parse(text), source: "openai" });
}
