import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

// Reads ANTHROPIC_API_KEY from the environment (.env loaded in server/index.ts).
export const client = new Anthropic();
export const MODEL = process.env.PM_MODEL || "claude-opus-5-5";

// Server-side refusal fallback is on: if the main model declines, the API retries on a fallback model.
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export async function structured<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  effort: "low" | "medium" | "high" = "low",
): Promise<z.infer<S>> {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined this turn");
  if (!res.parsed_output) throw new Error(`No structured output (stop_reason=${res.stop_reason})`);
  return res.parsed_output as z.infer<S>;
}

// The associate's live fact-check: Claude's server-side web search tool.
export async function factCheck(claim: string, context: string): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `You are a VC associate doing quick diligence during a pitch. Startup context: ${context}\n\nCheck this claim from the founder with a web search: "${claim}"\n\nReply in at most 2 sentences: what you found (name real competitors, numbers or sources), and whether the claim holds up, is shaky, or is contradicted. No markdown.`,
    },
  ];
  for (let i = 0; i < 3; i++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || "Could not verify that claim.";
  }
  return "Search took too long; could not verify that claim.";
}

// The engine takes its model calls through this interface so the full flow can be tested
// without network access (see tests/). Production always uses realLlm.
export interface Llm {
  structured: typeof structured;
  factCheck: typeof factCheck;
}
export const realLlm: Llm = { structured, factCheck };
