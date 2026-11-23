// Types shared by the server (agent engine) and the browser (3D room + ledger).

export type AgentId =
  | "point"
  | "managing"
  | "numbers"
  | "domain"
  | "skeptic"
  | "associate"
  | "counsel";

export const AGENT_IDS: AgentId[] = [
  "point",
  "managing",
  "numbers",
  "domain",
  "skeptic",
  "associate",
  "counsel",
];

export type Phase =
  | "setup"
  | "pitch" // founder pitches + Q&A, all partners in the room
  | "huddle" // founder has left; partners debate privately and vote
  | "termsheet" // term sheet offered; founder negotiates
  | "closed" // deal signed or panel passed
  | "debrief"; // Bruin scorecard + feedback

export const GESTURES = [
  "neutral",
  "lean_in",
  "cross_arms",
  "nod",
  "head_shake",
  "take_notes",
  "skeptical_tilt",
  "smile",
] as const;
export type Gesture = (typeof GESTURES)[number];

export const WEAK_TOPICS = [
  "market_size",
  "traction",
  "unit_economics",
  "competition",
  "moat",
  "team",
  "go_to_market",
  "use_of_funds",
  "valuation_ask",
  "terms_knowledge",
  "clarity",
] as const;
export type WeakTopic = (typeof WEAK_TOPICS)[number];

export interface Terms {
  raise_amount: number; // USD
  pre_money: number; // USD
  liq_pref_multiple: number; // 1 = 1x
  participating: boolean;
  option_pool_pct: number; // 0.10 = 10% of post-money, carved from pre-money
  investor_board_seats: number;
  founder_board_seats: number;
  independent_board_seats: number;
  pro_rata: boolean;
  other_clauses: string[]; // plain-language extra clauses counsel added
}

export interface StartupInfo {
  founder_name: string;
  company: string;
  one_liner: string;
  stage: string; // e.g. "pre-seed", "seed"
  raise_amount: number;
  traction: string; // free text: revenue, users, growth
  extra: string; // anything else the founder wants the panel to know
}

export type LedgerKind =
  | "thought" // private reasoning summary of one agent
  | "stance" // opinion meter moved
  | "whisper" // private message agent -> agent
  | "fact_check" // associate checked a claim on the web
  | "weakness" // agent logged a founder weak spot
  | "vote" // huddle vote
  | "decision" // managing partner decision
  | "terms" // term sheet issued or changed
  | "memory" // what the panel remembered from earlier sessions
  | "system";

export interface LedgerEntry {
  id: number;
  t: number; // ms since session start
  agent: AgentId | "system";
  kind: LedgerKind;
  text: string;
  to?: AgentId;
  stance?: number;
  topic?: WeakTopic;
}

export interface TranscriptLine {
  t: number;
  speaker: AgentId | "founder";
  text: string;
}

export interface AgentView {
  id: AgentId;
  stance: number; // -100 (hard pass) .. 100 (must invest)
  gesture: Gesture;
  thinking: boolean;
}

// Events streamed from server to browser over SSE.
export type ServerEvent =
  | { type: "phase"; phase: Phase; note?: string }
  | { type: "agents"; agents: AgentView[] }
  | { type: "ledger"; entry: LedgerEntry }
  | { type: "speak"; line: TranscriptLine; audio?: string }
  | { type: "founder"; line: TranscriptLine }
  | { type: "terms"; terms: Terms; note: string }
  | { type: "busy"; busy: boolean; label?: string }
  | { type: "debrief"; debrief: Debrief }
  | { type: "error"; message: string };

export interface Debrief {
  verdict: string;
  feedback: { agent: AgentId; text: string }[];
  scorecard: Record<string, string | number | boolean | null> | null;
  weak_spots: { topic: string; times: number }[];
  simulation: { version: string; p50_take: number; mean_cost_of_terms: number; wipeout_pct: number; simulations: number }[];
  waterfall: { version: string; exit_value: number; founder_take: number; founder_take_clean_terms: number }[];
  bruin_ok: boolean;
  bruin_log: string;
}
