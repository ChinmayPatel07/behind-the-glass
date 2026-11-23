// The partner meeting: seven agents that each think for themselves every turn.
// Every agent gets its own private goal, sees the room, and independently decides what it
// thinks, how its opinion moves, whether to speak, whisper to a colleague, gesture, or log a
// founder weak spot. The orchestrator only decides who gets the floor (by each agent's own urgency).
import { z } from "zod";
import type { Response } from "express";
import {
  AGENT_IDS,
  GESTURES,
  WEAK_TOPICS,
  type AgentId,
  type AgentView,
  type Debrief,
  type LedgerEntry,
  type LedgerKind,
  type Phase,
  type ServerEvent,
  type StartupInfo,
  type Terms,
  type TranscriptLine,
} from "../src/shared/types.js";
import { FIRM, PERSONAS, ROOM_RULES } from "./agents.js";
import { realLlm, type Llm } from "./llm.js";
import { synthesize } from "./tts.js";
import { BandChannel, glasserNews } from "./sponsors.js";
import { memoryFor, runBruin, scorecardFor, simulationFor, waterfallFor, weakSpotsFor, writeSession } from "./bruin.js";

// Public market reference the panel uses (sources in docs/RESEARCH.md).
const MARKET = `Market reference (Carta): 2026 median seed valuation about $19.7M (Q3 2026 report); seed-round dilution has run about 18-20%. Standard founder-friendly seed terms are a 1x non-participating liquidation preference.`;

const AgentTurn = z.object({
  private_thought: z.string().describe("Your honest private read right now, 1-2 sentences."),
  stance: z.number().int().describe("Your opinion of investing, -100 (hard pass) to 100 (must win this deal)."),
  stance_reason: z.string().describe("Why your stance moved (or didn't), one short sentence."),
  urgency: z.number().int().describe("0-10: how badly you want the floor right now."),
  say: z.string().describe("What you say aloud if given the floor. Empty string if you would stay quiet."),
  gesture: z.enum(GESTURES),
  whisper_to: z.enum([...AGENT_IDS, "none"]),
  whisper: z.string().describe("Private note to one colleague, or empty."),
  weak_topic: z.enum([...WEAK_TOPICS, "none"]).describe("A founder weak spot you just noticed, or none."),
  weak_quote: z.string().describe("The founder's exact words that showed the weak spot, or empty."),
  fact_check: z.string().describe("Associate only: a factual claim to verify on the web, or empty."),
  call_behind_the_glass: z.boolean().describe("Managing partner only: true when you have heard enough."),
});
type AgentTurn = z.infer<typeof AgentTurn>;

const HuddleTurn = z.object({
  argument: z.string().describe("What you say to your partners, 1-3 spoken sentences."),
  vote: z.enum(["invest", "pass", "undecided"]),
  stance: z.number().int(),
  terms_view: z.string().describe("What terms you would want if we invest, one sentence."),
});

const TermsSchema = z.object({
  raise_amount: z.number(),
  pre_money: z.number(),
  liq_pref_multiple: z.number(),
  participating: z.boolean(),
  option_pool_pct: z.number().describe("Fraction of post-money, e.g. 0.10"),
  investor_board_seats: z.number().int(),
  founder_board_seats: z.number().int(),
  independent_board_seats: z.number().int(),
  pro_rata: z.boolean(),
  other_clauses: z.array(z.string()),
});

const Decision = z.object({
  decision: z.enum(["invest", "pass"]),
  reason: z.string(),
  terms: TermsSchema,
  announcer: z.enum(["point", "managing"]),
  announcement: z.string().describe("Spoken to the founder when they come back in, 1-3 sentences."),
});

const NegotiationMove = z.object({
  updated_terms: TermsSchema,
  speaker: z.enum(["point", "managing", "numbers", "skeptic", "counsel"]),
  response: z.string().describe("Spoken reply to the founder, 1-3 sentences."),
  deal_status: z.enum(["open", "final_offer", "walk_away"]),
  reason: z.string(),
});

const Feedback = z.object({
  verdict: z.string().describe("One sentence overall verdict."),
  feedback: z.array(
    z.object({
      agent: z.enum(["point", "managing", "numbers", "domain", "skeptic", "associate", "counsel"]),
      text: z.string().describe("Evidence-based feedback quoting the founder's own words, 1-2 sentences."),
    }),
  ),
});

const PITCH_SPEAKERS = AGENT_IDS.filter((a) => PERSONAS[a].speaksIn.includes("pitch"));
const NEGOTIATORS: AgentId[] = ["point", "managing", "numbers", "skeptic", "counsel"];

const money = (n: number) => `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
export const termsText = (t: Terms) =>
  `raise ${money(t.raise_amount)} at ${money(t.pre_money)} pre-money; ${t.liq_pref_multiple}x ${t.participating ? "participating" : "non-participating"} liquidation preference; option pool ${(t.option_pool_pct * 100).toFixed(0)}% of post; board ${t.founder_board_seats} founder / ${t.investor_board_seats} investor / ${t.independent_board_seats} independent; pro rata ${t.pro_rata ? "yes" : "no"}${t.other_clauses.length ? `; other: ${t.other_clauses.join("; ")}` : ""}.`;

export class Session {
  id: string;
  info: StartupInfo;
  founderKey: string;
  phase: Phase = "pitch";
  started = Date.now();
  transcript: TranscriptLine[] = [];
  ledger: LedgerEntry[] = [];
  agents: Record<AgentId, AgentView>;
  terms: Terms | null = null;
  initialTerms: Terms | null = null;
  concessions: { term: string; from: string; to: string; by: "investors" | "founder_gave" }[] = [];
  votes: { agent: AgentId; vote: string; reason: string }[] = [];
  outcome: "signed" | "pass" | "walked_away" | "open" = "open";
  memory: string | null = null;
  diligence: string | null = null; // associate's pre-meeting memo (Glasser news)
  private band: BandChannel | null = null; // live partner channel in BAND
  busy = false;
  founderTurns = 0;
  negotiationRounds = 0;
  private events: ServerEvent[] = [];
  private clients = new Set<Response>();
  private ledgerSeq = 0;

  constructor(
    id: string,
    info: StartupInfo,
    private llm: Llm = realLlm,
  ) {
    this.id = id;
    this.info = info;
    this.founderKey = info.founder_name.trim().toLowerCase();
    this.agents = Object.fromEntries(
      AGENT_IDS.map((a) => [a, { id: a, stance: a === "point" ? 30 : 0, gesture: "neutral", thinking: false }]),
    ) as Record<AgentId, AgentView>;
  }

  // ---------- event plumbing ----------
  attach(res: Response) {
    this.clients.add(res);
    for (const e of this.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.on("close", () => this.clients.delete(res));
  }
  private emit(e: ServerEvent) {
    if (e.type !== "busy" && e.type !== "agents") this.events.push(e);
    for (const c of this.clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
  }
  private t() {
    return Date.now() - this.started;
  }
  private log(agent: AgentId | "system", kind: LedgerKind, text: string, extra: Partial<LedgerEntry> = {}) {
    const entry: LedgerEntry = { id: ++this.ledgerSeq, t: this.t(), agent, kind, text, ...extra };
    this.ledger.push(entry);
    this.emit({ type: "ledger", entry });
    // Mirror the partners' private channel into the BAND room.
    if (this.band && ["whisper", "fact_check", "vote", "decision", "terms", "memory"].includes(kind) && agent !== "system") {
      const who = PERSONAS[agent].name;
      const to = extra.to ? ` → ${PERSONAS[extra.to].name}` : "";
      this.band.post(`[${who}${to} · ${kind.replace("_", "-")}] ${text}`);
    }
  }
  // Voices are generated before the line is emitted so caption and audio arrive together.
  private async speak(speaker: AgentId, text: string) {
    await this.speakMany([[speaker, text]]);
  }
  private async speakMany(lines: [AgentId, string][]) {
    const audio = await Promise.all(lines.map(([a, text]) => synthesize(a, text).catch(() => null)));
    lines.forEach(([speaker, text], i) => {
      const line = { t: this.t(), speaker, text };
      this.transcript.push(line);
      this.emit({ type: "speak", line, audio: audio[i] ?? undefined });
    });
  }
  private pushAgents() {
    this.emit({ type: "agents", agents: Object.values(this.agents) });
  }
  private setPhase(phase: Phase, note?: string) {
    this.phase = phase;
    this.emit({ type: "phase", phase, note });
  }
  private setBusy(busy: boolean, label?: string) {
    this.busy = busy;
    this.emit({ type: "busy", busy, label });
  }

  // ---------- prompts ----------
  private system(a: AgentId) {
    const p = PERSONAS[a];
    return `${ROOM_RULES}

You are ${p.name}, ${p.title} at ${FIRM}.
Your private goal: ${p.goal}
How you talk: ${p.style}
${this.memory ? `\nYour memory of this founder from earlier sessions (stored by the firm's data pipeline): ${this.memory}\nUse it: probe the old weak spots early and notice whether they improved.` : ""}`;
  }

  private roomState(a: AgentId) {
    const i = this.info;
    const recent = this.transcript
      .slice(-24)
      .map((l) => `${l.speaker === "founder" ? `FOUNDER (${i.founder_name})` : PERSONAS[l.speaker].name}: ${l.text}`)
      .join("\n");
    const toMe = this.ledger
      .filter((e) => e.kind === "whisper" && e.to === a)
      .slice(-6)
      .map((e) => `${PERSONAS[e.agent as AgentId].name} whispered to you: ${e.text}`)
      .join("\n");
    const facts = this.ledger
      .filter((e) => e.kind === "fact_check")
      .slice(-3)
      .map((e) => `Associate's fact-check: ${e.text}`)
      .join("\n");
    const stances = AGENT_IDS.filter((x) => x !== a)
      .map((x) => `${PERSONAS[x].name} (${x}): ${this.agents[x].stance}`)
      .join(", ");
    return `STARTUP: ${i.company} — ${i.one_liner}
Founder: ${i.founder_name}. Stage: ${i.stage}. Raising: ${money(i.raise_amount)}.
Traction the founder shared: ${i.traction || "not given"}
Other notes from the founder: ${i.extra || "none"}

PHASE: ${this.phase}. Founder turns so far: ${this.founderTurns}.
${this.terms ? `CURRENT TERM SHEET: ${termsText(this.terms)}` : ""}
Your current stance: ${this.agents[a].stance}. Colleagues' visible stances: ${stances}

CONVERSATION SO FAR:
${recent || "(nothing yet)"}
${toMe ? `\nPRIVATE MESSAGES TO YOU:\n${toMe}` : ""}
${facts ? `\n${facts}` : ""}${this.diligence ? `\nAssociate's pre-meeting diligence (recent news in this market, via Glasser): ${this.diligence}` : ""}`;
  }

  // ---------- flow ----------
  async start() {
    this.memory = await memoryFor(this.founderKey);
    if (this.memory) this.log("system", "memory", `Panel remembers this founder: ${this.memory}`);
    const [band, news] = await Promise.all([
      BandChannel.open().catch((e) => {
        this.log("system", "system", `BAND channel unavailable: ${(e as Error).message}`);
        return null;
      }),
      glasserNews(`${this.info.one_liner} startup funding competitors`).catch((e) => {
        this.log("system", "system", `Glasser diligence unavailable: ${(e as Error).message}`);
        return [];
      }),
    ]);
    this.band = band;
    if (band) {
      this.log("system", "system", `Partner channel is live in BAND (room ${band.chatId}).`);
      band.post(`Partner channel opened for ${this.info.company} (${this.info.founder_name}) — ${this.info.one_liner}. Whispers, fact-checks and votes follow.`);
    }
    if (news.length) {
      this.diligence = news.map((n) => `${n.title}${n.source ? ` (${n.source}${n.date_text ? `, ${n.date_text}` : ""})` : ""}`).join("; ");
      this.log("associate", "fact_check", `Pre-meeting diligence via Glasser — recent news in this market: ${this.diligence}`);
    }
    this.pushAgents();
    this.setPhase("pitch");
    await this.speak(
      "point",
      `Everyone, this is ${this.info.founder_name} from ${this.info.company}. ${this.info.one_liner}. They're raising ${money(this.info.raise_amount)}. ${this.info.founder_name}, the floor is yours.`,
    );
  }

  async founderSays(text: string) {
    if (this.busy) return;
    const line = { t: this.t(), speaker: "founder" as const, text };
    this.transcript.push(line);
    this.emit({ type: "founder", line });
    this.founderTurns++;
    try {
      if (this.phase === "pitch") await this.pitchRound();
      else if (this.phase === "termsheet") await this.negotiationRound();
    } catch (e) {
      this.emit({ type: "error", message: String((e as Error).message ?? e) });
      this.setBusy(false);
    }
  }

  // Every in-room agent thinks independently and in parallel.
  private async thinkAll(ids: AgentId[], instruction: string): Promise<Partial<Record<AgentId, AgentTurn>>> {
    ids.forEach((a) => (this.agents[a].thinking = true));
    this.pushAgents();
    const results = await Promise.allSettled(
      ids.map((a) =>
        this.llm.structured(AgentTurn, this.system(a), `${this.roomState(a)}\n\n${instruction}`, "low").finally(() => {
          this.agents[a].thinking = false;
          this.pushAgents();
        }),
      ),
    );
    const out: Partial<Record<AgentId, AgentTurn>> = {};
    results.forEach((r, i) => {
      const a = ids[i];
      if (r.status === "fulfilled") out[a] = r.value;
      else this.log("system", "system", `${PERSONAS[a].name} lost their train of thought (${(r.reason as Error)?.message ?? r.reason}).`);
    });
    for (const [a, turn] of Object.entries(out) as [AgentId, AgentTurn][]) this.applyTurn(a, turn);
    this.pushAgents();
    return out;
  }

  private applyTurn(a: AgentId, turn: AgentTurn) {
    const v = this.agents[a];
    const stance = Math.max(-100, Math.min(100, Math.round(turn.stance)));
    this.log(a, "thought", turn.private_thought);
    if (stance !== v.stance) this.log(a, "stance", `${v.stance} → ${stance}: ${turn.stance_reason}`, { stance });
    v.stance = stance;
    v.gesture = turn.gesture;
    if (turn.whisper_to !== "none" && turn.whisper.trim() && turn.whisper_to !== a)
      this.log(a, "whisper", turn.whisper, { to: turn.whisper_to });
    if (turn.weak_topic !== "none")
      this.log(a, "weakness", turn.weak_quote ? `"${turn.weak_quote}"` : turn.weak_topic, { topic: turn.weak_topic });
  }

  private pickSpeakers(turns: Partial<Record<AgentId, AgentTurn>>, allowed: AgentId[]) {
    const ranked = (Object.entries(turns) as [AgentId, AgentTurn][])
      .filter(([a, t]) => allowed.includes(a) && t.say.trim().length > 0)
      .sort((x, y) => y[1].urgency - x[1].urgency);
    const picks = ranked.slice(0, 1);
    if (ranked[1] && ranked[1][1].urgency >= 7) picks.push(ranked[1]);
    return picks;
  }

  private async pitchRound() {
    this.setBusy(true, "The partners are thinking…");
    const turns = await this.thinkAll(
      AGENT_IDS.filter((a) => a !== "counsel"),
      `The founder just spoke. Decide independently what you think and do now.
- Only speak if you have a sharp question or reaction; otherwise leave "say" empty.
- Ask ONE question at a time. Do not repeat a question someone already asked.
- Associate: put one checkable factual claim in fact_check if the founder made one worth checking.
- Managing partner: set call_behind_the_glass true once the key questions are answered (usually after 3-5 founder answers). Everyone else: false.`,
    );

    // Associate's live web fact-check.
    const claim = turns.associate?.fact_check?.trim();
    if (claim) {
      this.setBusy(true, "Sam is fact-checking…");
      try {
        const found = await this.llm.factCheck(claim, `${this.info.company}: ${this.info.one_liner}`);
        this.log("associate", "fact_check", `Claim: "${claim}" → ${found}`);
        this.log("associate", "whisper", found, { to: "skeptic" });
      } catch (e) {
        this.log("system", "system", `Fact-check failed: ${(e as Error).message}`);
      }
    }

    await this.speakMany(this.pickSpeakers(turns, PITCH_SPEAKERS).map(([a, t]) => [a, t.say] as [AgentId, string]));

    const mpWantsMeeting = turns.managing?.call_behind_the_glass && this.founderTurns >= 3;
    if (mpWantsMeeting || this.founderTurns >= 6) {
      this.log("managing", "decision", "Calls the partner meeting: founder steps out.");
      await this.speak("managing", "Thank you. Give us a few minutes, we'll call you back in.");
      await this.huddle();
    }
    this.setBusy(false);
  }

  private async huddle() {
    this.setPhase("huddle", "You stepped out. You can see them through the glass.");
    this.setBusy(true, "Partners are debating behind the glass…");
    const roundArgs: string[] = [];
    for (let round = 1; round <= 2; round++) {
      const prior = roundArgs.length ? `\nWhat partners said so far in this meeting:\n${roundArgs.join("\n")}` : "";
      const results = await Promise.allSettled(
        AGENT_IDS.map((a) =>
          this.llm.structured(
            HuddleTurn,
            this.system(a),
            `${this.roomState(a)}\n\nThe founder has left the room. This is the private partner debate, round ${round} of 2.${prior}\n${MARKET}\nArgue your position honestly from your own goal and vote. ${round === 2 ? "This is your final vote: invest or pass." : ""}`,
            "low",
          ),
        ),
      );
      const overheard: [AgentId, string][] = [];
      results.forEach((r, i) => {
        const a = AGENT_IDS[i];
        if (r.status !== "fulfilled") return;
        const h = r.value;
        this.agents[a].stance = Math.max(-100, Math.min(100, Math.round(h.stance)));
        this.agents[a].gesture = h.vote === "invest" ? "nod" : h.vote === "pass" ? "head_shake" : "skeptical_tilt";
        // Round 1 is overheard through the glass; round 2 shows up as votes in the ledger.
        if (round === 1) overheard.push([a, h.argument]);
        else this.log(a, "thought", h.argument);
        this.log(a, "vote", `${h.vote.toUpperCase()} — terms view: ${h.terms_view}`);
        roundArgs.push(`${PERSONAS[a].name}: ${h.argument} (vote: ${h.vote}; terms: ${h.terms_view})`);
        if (round === 2) this.votes.push({ agent: a, vote: h.vote, reason: h.argument });
      });
      this.pushAgents();
      await this.speakMany(overheard);
    }

    const tally = this.votes.map((v) => `${PERSONAS[v.agent].name}: ${v.vote}`).join(", ");
    const d = await this.llm.structured(
      Decision,
      this.system("managing"),
      `${this.roomState("managing")}\n\nPartner meeting debate:\n${roundArgs.join("\n")}\nFinal votes: ${tally}\n${MARKET}\nYou decide. If invest, set the term sheet. Raise amount should be what the founder asked (${money(this.info.raise_amount)}) unless you have a reason. Set valuation, preference, participation, option pool, board and clauses to reflect the partners' concerns: the more doubt, the more investor protection. Counsel's view matters for clauses.`,
      "medium",
    );
    this.log("managing", "decision", `${d.decision.toUpperCase()}: ${d.reason}`);
    this.setPhase(d.decision === "invest" ? "termsheet" : "closed", "You're called back into the room.");
    await this.speak(d.announcer, d.announcement);
    if (d.decision === "invest") {
      this.terms = d.terms;
      this.initialTerms = structuredClone(d.terms);
      this.log("counsel", "terms", `Term sheet issued: ${termsText(d.terms)}`);
      this.emit({ type: "terms", terms: d.terms, note: "Term sheet on the table. Negotiate, or sign." });
    } else {
      this.outcome = "pass";
      await this.finish();
    }
  }

  private async negotiationRound() {
    if (!this.terms) return;
    this.setBusy(true, "Partners are conferring…");
    this.negotiationRounds++;
    const turns = await this.thinkAll(
      NEGOTIATORS,
      `You are negotiating the term sheet. The founder just responded. ${MARKET}
Decide privately what you would concede and what you would hold, and whisper your recommendation to the managing partner (whisper_to "managing"). Leave "say" empty unless you must speak.`,
    );
    const recs = (Object.entries(turns) as [AgentId, AgentTurn][])
      .map(([a, t]) => `${PERSONAS[a].name} (stance ${t.stance}): ${t.private_thought} Whisper: ${t.whisper}`)
      .join("\n");
    const move = await this.llm.structured(
      NegotiationMove,
      this.system("managing"),
      `${this.roomState("managing")}\n\nYour partners' private recommendations:\n${recs}\n${MARKET}\nNegotiation round ${this.negotiationRounds}. Decide the firm's move: update the terms (concede some, hold others) based on how strong the founder's arguments are, pick who answers aloud, and set deal_status. After 4 rounds lean toward final_offer. Walk away only if the founder is unreasonable.`,
      "medium",
    );
    this.diffTerms(this.terms, move.updated_terms);
    this.terms = move.updated_terms;
    this.log("managing", "decision", `${move.deal_status.replace("_", " ")}: ${move.reason}`);
    this.emit({ type: "terms", terms: move.updated_terms, note: move.deal_status === "final_offer" ? "Final offer." : "Updated terms." });
    await this.speak(move.speaker, move.response);
    if (move.deal_status === "walk_away") {
      this.outcome = "walked_away";
      this.setPhase("closed", "The firm walked away.");
      await this.finish();
    }
    this.setBusy(false);
  }

  private diffTerms(a: Terms, b: Terms) {
    const fields: [keyof Terms, (t: Terms) => string, (x: Terms, y: Terms) => boolean][] = [
      ["pre_money", (t) => money(t.pre_money), (x, y) => y.pre_money > x.pre_money],
      ["liq_pref_multiple", (t) => `${t.liq_pref_multiple}x`, (x, y) => y.liq_pref_multiple < x.liq_pref_multiple],
      ["participating", (t) => (t.participating ? "participating" : "non-participating"), (x, y) => !y.participating],
      ["option_pool_pct", (t) => `${(t.option_pool_pct * 100).toFixed(0)}%`, (x, y) => y.option_pool_pct < x.option_pool_pct],
      ["investor_board_seats", (t) => `${t.investor_board_seats}`, (x, y) => y.investor_board_seats < x.investor_board_seats],
      ["pro_rata", (t) => (t.pro_rata ? "yes" : "no"), (x, y) => !y.pro_rata],
    ];
    for (const [k, fmt, founderWins] of fields) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      const by = founderWins(a, b) ? "investors" : "founder_gave";
      this.concessions.push({ term: k, from: fmt(a), to: fmt(b), by });
      this.log("counsel", "terms", `${k.replace(/_/g, " ")}: ${fmt(a)} → ${fmt(b)} (${by === "investors" ? "firm conceded" : "founder gave ground"})`);
    }
  }

  async sign() {
    if (this.phase !== "termsheet" || !this.terms || this.busy) return;
    this.outcome = "signed";
    await this.speak("managing", "Then we have a deal. Welcome to the portfolio.");
    this.log("managing", "decision", `Signed: ${termsText(this.terms)}`);
    this.setPhase("closed", "Term sheet signed.");
    await this.finish();
  }

  // ---------- debrief: Bruin pipeline + evidence-based feedback ----------
  private async finish() {
    this.setBusy(true, "Running the Bruin pipeline…");
    writeSession(this.id, {
      session_id: this.id,
      founder_key: this.founderKey,
      founder_name: this.info.founder_name,
      company: this.info.company,
      stage: this.info.stage,
      started_at: new Date(this.started).toISOString(),
      ended_at: new Date().toISOString(),
      outcome: this.outcome,
      founder_turns: this.founderTurns,
      negotiation_rounds: this.negotiationRounds,
      initial_terms: this.initialTerms,
      final_terms: this.terms,
      concessions: this.concessions,
      votes: this.votes,
      final_stances: Object.fromEntries(AGENT_IDS.map((a) => [a, this.agents[a].stance])),
      weak_spots: this.ledger
        .filter((e) => e.kind === "weakness")
        .map((e) => ({ agent: e.agent, topic: e.topic, quote: e.text })),
      ledger: this.ledger,
      transcript: this.transcript,
    });
    const bruin = await runBruin();
    const scorecard = await scorecardFor(this.id).catch(() => null);
    const weak = await weakSpotsFor(this.founderKey).catch(() => []);
    const waterfall = await waterfallFor(this.id).catch(() => []);
    const simulation = await simulationFor(this.id).catch(() => []);

    this.setBusy(true, "Partners are writing your feedback…");
    const transcript = this.transcript
      .map((l) => `${l.speaker === "founder" ? "FOUNDER" : PERSONAS[l.speaker].name}: ${l.text}`)
      .join("\n");
    const weakLog = this.ledger
      .filter((e) => e.kind === "weakness")
      .map((e) => `${PERSONAS[e.agent as AgentId]?.name}: ${e.topic} ${e.text}`)
      .join("\n");
    let fb: z.infer<typeof Feedback> = { verdict: "", feedback: [] };
    try {
      fb = await this.llm.structured(
        Feedback,
        `${ROOM_RULES}\nThe meeting is over. You now step out of the negotiation and give the founder honest, specific, evidence-based coaching, each partner in their own voice.`,
        `Startup: ${this.info.company}. Outcome: ${this.outcome}.\n${this.initialTerms ? `First offer: ${termsText(this.initialTerms)}` : ""}\n${this.terms && this.outcome === "signed" ? `Signed: ${termsText(this.terms)}` : ""}\nScorecard from the data pipeline: ${JSON.stringify(scorecard)}\nWeak spots partners logged:\n${weakLog}\n\nFull transcript:\n${transcript}\n\nGive one verdict sentence and exactly seven feedback items, one from each partner: point, managing, numbers, domain, skeptic, associate, counsel. Quote the founder's exact words as evidence. Say what to do differently next time.`,
        "medium",
      );
    } catch (e) {
      this.emit({ type: "error", message: `Feedback failed: ${(e as Error).message}` });
    }
    const debrief: Debrief = {
      verdict: fb.verdict,
      feedback: fb.feedback,
      scorecard,
      weak_spots: weak,
      waterfall,
      simulation,
      bruin_ok: bruin.ok,
      bruin_log: bruin.log,
    };
    this.setPhase("debrief");
    this.emit({ type: "debrief", debrief });
    this.setBusy(false);
  }
}
