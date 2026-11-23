// Test double for the Claude calls. Returns schema-shaped answers so the whole
// pitch → partner meeting → term sheet → debrief flow runs offline. Test use only.
import type { z } from "zod";
import type { Llm } from "../server/llm.js";

const terms = (pre: number) => ({
  raise_amount: 3_000_000,
  pre_money: pre,
  liq_pref_multiple: 2,
  participating: true,
  option_pool_pct: 0.15,
  investor_board_seats: 2,
  founder_board_seats: 1,
  independent_board_seats: 0,
  pro_rata: true,
  other_clauses: ["30-day no-shop"],
});

export function fakeLlm(opts: { delayMs?: number; huddleDelayMs?: number } = {}): Llm & { calls: number } {
  const llm = {
    calls: 0,
    async structured<S extends z.ZodType>(schema: S, system: string, user: string): Promise<z.infer<S>> {
      llm.calls++;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const keys = Object.keys((schema as unknown as { shape: object }).shape);
      if (opts.huddleDelayMs && keys.includes("argument")) await new Promise((r) => setTimeout(r, opts.huddleDelayMs));
      const name = /\nYou are ([A-Z][a-z]+ [A-Z][a-z]+),/.exec(system)?.[1] ?? "Partner";
      const turns = Number(/Founder turns so far: (\d+)/.exec(user)?.[1] ?? 0);
      let out: unknown;
      if (keys.includes("private_thought"))
        out = {
          private_thought: `(test) ${name} is weighing the answer.`,
          stance: name.startsWith("Rex") ? -20 : 25,
          stance_reason: "(test) reacting to the last answer",
          urgency: name.startsWith("Maya") ? 9 : name.startsWith("Rex") ? 8 : 3,
          say: `(test) ${name} asks question ${turns}.`,
          gesture: name.startsWith("Rex") ? "cross_arms" : "lean_in",
          whisper_to: name.startsWith("Sam") ? "skeptic" : "none",
          whisper: name.startsWith("Sam") ? "(test) claim looks shaky" : "",
          weak_topic: name.startsWith("Maya") ? "unit_economics" : "none",
          weak_quote: name.startsWith("Maya") ? "(test) quote" : "",
          fact_check: name.startsWith("Sam") && turns === 1 ? "(test) no competitors" : "",
          call_partner_meeting: name.startsWith("Harold") && turns >= 3,
        };
      else if (keys.includes("argument"))
        out = { argument: `(test) ${name} argues.`, vote: name.startsWith("Rex") ? "pass" : "invest", stance: 30, terms_view: "(test) 1x pref" };
      else if (keys.includes("decision"))
        out = { decision: "invest", reason: "(test) majority invest", terms: terms(12_000_000), announcer: "managing", announcement: "(test) We'd like to invest." };
      else if (keys.includes("updated_terms")) {
        const pre = Number(/raise \$[\d.]+M at \$([\d.]+)M pre-money/.exec(user)?.[1] ?? 12) * 1e6;
        out = { updated_terms: { ...terms(pre + 1_000_000), liq_pref_multiple: 1, participating: false }, speaker: "numbers", response: "(test) We can move on price.", deal_status: "open", reason: "(test) founder argued well" };
      } else if (keys.includes("verdict"))
        out = { verdict: "(test) verdict", feedback: [{ agent: "numbers", text: "(test) feedback" }] };
      else throw new Error(`fake llm: unknown schema ${keys.join(",")}`);
      return schema.parse(out) as z.infer<S>;
    },
    async factCheck(claim: string) {
      return `(test) checked: ${claim}`;
    },
  };
  return llm;
}
