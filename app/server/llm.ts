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

export interface Source {
  title: string;
  url: string;
  summary: string;
  provider: string;
}

// Telem's router fans one query out to several search providers and returns one normalized envelope.
export async function telemSearch(query: string, numResults = 4): Promise<Source[]> {
  const res = await fetch("https://router.telem.ai/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TELEM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_input: { query }, search: { providers: { include: ["exa", "brave"] }, num_results: numResults } }),
  });
  if (!res.ok) throw new Error(`Telem search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    preprocessor_runs?: { preprocessor_name: string; output_payload: { results?: Omit<Source, "provider">[] } | null }[];
  };
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const run of data.preprocessor_runs ?? [])
    for (const r of run.output_payload?.results ?? []) {
      if (seen.has(r.url)) continue; // providers overlap; urls are normalized so one pass merges them
      seen.add(r.url);
      out.push({ title: r.title, url: r.url, summary: r.summary ?? "", provider: run.preprocessor_name });
    }
  return out.slice(0, 8);
}

const domain = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

// The associate's live fact-check: Telem finds the evidence on the live web, Claude judges the claim
// against those sources only. Without a Telem key it falls back to Claude's own web search tool.
export async function factCheck(claim: string, context: string): Promise<string> {
  if (process.env.TELEM_API_KEY) {
    const sources = await telemSearch(`${claim} ${context}`.slice(0, 300));
    if (!sources.length) return "Searched the web (Telem) and found nothing that confirms this claim.";
    const evidence = sources.map((s, i) => `[${i + 1}] ${s.title} (${domain(s.url)}): ${s.summary.slice(0, 400)}`).join("\n");
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `You are a VC associate doing quick diligence during a pitch. Startup context: ${context}\n\nFounder's claim: "${claim}"\n\nLive web results:\n${evidence}\n\nIn at most 2 sentences, using ONLY these results: say what you found (name real companies or numbers) and whether the claim holds up, is shaky, or is contradicted. Cite sources as [n]. No markdown.`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    const cited = sources.filter((_, i) => text.includes(`[${i + 1}]`)).map((s) => domain(s.url));
    return `${text}${cited.length ? ` — sources: ${[...new Set(cited)].join(", ")}` : ""} (via Telem)`;
  }
  return claudeWebFactCheck(claim, context);
}

async function claudeWebFactCheck(claim: string, context: string): Promise<string> {
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
