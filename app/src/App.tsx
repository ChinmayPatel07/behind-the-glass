import { useEffect, useMemo, useRef, useState } from "react";
import Room from "./Room";
import { CAST } from "./cast";
import { voice } from "./voice";
import {
  AGENT_IDS,
  type AgentId,
  type AgentView,
  type Debrief,
  type LedgerEntry,
  type Phase,
  type ServerEvent,
  type StartupInfo,
  type Terms,
  type TranscriptLine,
} from "./shared/types";

const emptyAgents = () =>
  Object.fromEntries(AGENT_IDS.map((a) => [a, { id: a, stance: 0, gesture: "neutral", thinking: false }])) as Record<AgentId, AgentView>;

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  thought: "thinks",
  stance: "opinion",
  whisper: "whispers",
  fact_check: "fact-check",
  weakness: "logs weak spot",
  vote: "votes",
  decision: "decides",
  terms: "terms",
  memory: "memory",
  system: "system",
};

const money = (n: number) => `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;

export default function App() {
  const [info, setInfo] = useState<StartupInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [phaseNote, setPhaseNote] = useState("");
  const [agents, setAgents] = useState(emptyAgents);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [speaking, setSpeaking] = useState<{ speaker: AgentId; text: string } | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [termsNote, setTermsNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [filter, setFilter] = useState<"all" | "whisper" | "thought">("all");

  useEffect(
    () => voice.onChange((l) => setSpeaking(l && l.speaker !== "founder" ? { speaker: l.speaker as AgentId, text: l.text } : null)),
    [],
  );
  useEffect(() => {
    voice.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/session/${sessionId}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as ServerEvent;
      switch (e.type) {
        case "phase":
          // Leftover behind-the-glass chatter is dropped once the founder is called back in.
          if (e.phase === "termsheet") voice.clearPending();
          setPhase(e.phase);
          setPhaseNote(e.note ?? "");
          break;
        case "agents":
          setAgents(Object.fromEntries(e.agents.map((a) => [a.id, a])) as Record<AgentId, AgentView>);
          break;
        case "ledger":
          setLedger((l) => (l.some((x) => x.id === e.entry.id) ? l : [...l, e.entry]));
          break;
        case "speak":
          setLines((l) => [...l, e.line]);
          voice.enqueue(e.line);
          break;
        case "founder":
          setLines((l) => [...l, e.line]);
          break;
        case "terms":
          setTerms(e.terms);
          setTermsNote(e.note);
          break;
        case "busy":
          setBusy(e.busy ? (e.label ?? "…") : null);
          break;
        case "debrief":
          setDebrief(e.debrief);
          break;
        case "error":
          setError(e.message);
          break;
      }
    };
    return () => es.close();
  }, [sessionId]);

  async function start(i: StartupInfo) {
    setInfo(i);
    setAgents(emptyAgents());
    setLedger([]);
    setLines([]);
    setTerms(null);
    setDebrief(null);
    setError(null);
    const r = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(i) });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Could not start");
    setSessionId(j.id);
    setPhase("pitch");
  }

  if (phase === "setup" || !info) return <Setup onStart={start} error={error} />;

  return (
    <div className="layout">
      <div className="stage">
        <Room agents={agents} phase={phase} speaking={speaking} terms={terms} />
        <div className="hud-top">
          <div className="brand">
            Behind the Glass <span>· {info.company}</span>
          </div>
          <div className={`phase phase-${phase}`}>{phaseLabel(phase)}</div>
          {phaseNote && <div className="phase-note">{phaseNote}</div>}
          <button className="ghost" onClick={() => setMuted((m) => !m)}>
            {muted ? "🔇 Voices off" : "🔊 Voices on"}
          </button>
        </div>
        {terms && (phase === "termsheet" || phase === "closed") && (
          <TermSheet terms={terms} note={termsNote} canSign={phase === "termsheet" && !busy} onSign={() => fetch(`/api/session/${sessionId}/sign`, { method: "POST" })} />
        )}
        <Chat
          lines={lines}
          busy={busy}
          speaking={speaking}
          phase={phase}
          sessionId={sessionId}
          error={error}
          setError={setError}
          founder={info.founder_name}
          narrow={Boolean(terms && (phase === "termsheet" || phase === "closed"))}
        />
        {debrief && <DebriefView d={debrief} info={info} onAgain={() => start(info)} />}
      </div>
      <aside className="ledger">
        <div className="ledger-head">
          <h2>Decision ledger</h2>
          <p>Every agent's private thoughts, opinion shifts, whispers and votes — live.</p>
          <div className="chips">
            {(["all", "whisper", "thought"] as const).map((f) => (
              <button key={f} className={filter === f ? "chip on" : "chip"} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "whisper" ? "Whispers" : "Thoughts"}
              </button>
            ))}
          </div>
        </div>
        <Ledger entries={ledger.filter((e) => filter === "all" || e.kind === filter)} />
      </aside>
    </div>
  );
}

function phaseLabel(p: Phase) {
  return { setup: "Setup", pitch: "Pitch & Q&A", huddle: "Partner meeting (you're outside)", termsheet: "Term sheet negotiation", closed: "Meeting over", debrief: "Debrief" }[p];
}

function Setup({ onStart, error }: { onStart: (i: StartupInfo) => void; error: string | null }) {
  const [f, setF] = useState<StartupInfo>({ founder_name: "", company: "", one_liner: "", stage: "seed", raise_amount: 3_000_000, traction: "", extra: "" });
  const set = (k: keyof StartupInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === "raise_amount" ? Number(e.target.value) * 1e6 : e.target.value });
  return (
    <div className="setup">
      <div className="setup-card">
        <h1>Behind the Glass</h1>
        <p className="lede">
          Pitch seven AI investors at their Monday partner meeting. They question you, fact-check you, debate you behind the glass, and — if
          they bite — negotiate a real term sheet. Then you see what your deal would cost you.
        </p>
        <div className="grid2">
          <label>
            Your name<input value={f.founder_name} onChange={set("founder_name")} placeholder="Same name = the panel remembers you" />
          </label>
          <label>
            Company<input value={f.company} onChange={set("company")} />
          </label>
        </div>
        <label>
          One-liner<input value={f.one_liner} onChange={set("one_liner")} placeholder="What you do, for whom" />
        </label>
        <div className="grid2">
          <label>
            Stage
            <select value={f.stage} onChange={set("stage")}>
              <option value="pre-seed">Pre-seed</option>
              <option value="seed">Seed</option>
              <option value="series-a">Series A</option>
            </select>
          </label>
          <label>
            Raising ($M)
            <input type="number" min={0.25} step={0.25} value={f.raise_amount / 1e6} onChange={set("raise_amount")} />
          </label>
        </div>
        <label>
          Traction<textarea rows={2} value={f.traction} onChange={set("traction")} placeholder="Revenue, users, growth, pilots…" />
        </label>
        <label>
          Anything else the panel should know<textarea rows={2} value={f.extra} onChange={set("extra")} />
        </label>
        {error && <div className="err">{error}</div>}
        <button className="primary" disabled={!f.founder_name || !f.company || !f.one_liner} onClick={() => onStart(f)}>
          Walk into the room →
        </button>
        <div className="cast-row">
          {AGENT_IDS.map((a) => (
            <span key={a} style={{ borderColor: CAST[a].color }}>
              <b style={{ color: CAST[a].color }}>{CAST[a].name}</b> {CAST[a].role}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chat(props: {
  lines: TranscriptLine[];
  busy: string | null;
  speaking: { speaker: AgentId; text: string } | null;
  phase: Phase;
  sessionId: string | null;
  error: string | null;
  setError: (e: string | null) => void;
  founder: string;
  narrow: boolean;
}) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.lines.length, props.busy]);
  // The founder answers once the partners have finished talking (or skips ahead).
  const canTalk = (props.phase === "pitch" || props.phase === "termsheet") && !props.busy && !props.speaking;
  async function send() {
    const t = text.trim();
    if (!t || !canTalk) return;
    setText("");
    props.setError(null);
    const r = await fetch(`/api/session/${props.sessionId}/say`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
    if (!r.ok) props.setError((await r.json()).error ?? "Could not send");
  }
  return (
    <div className={props.narrow ? "chat narrow" : "chat"}>
      <div className="lines">
        {props.lines.slice(-8).map((l, i) => (
          <div key={i} className={l.speaker === "founder" ? "line me" : "line"}>
            <b style={{ color: l.speaker === "founder" ? "#e7e5e4" : CAST[l.speaker].color }}>{l.speaker === "founder" ? props.founder : CAST[l.speaker].name}</b> {l.text}
          </div>
        ))}
        {props.busy && <div className="line busy">{props.busy}</div>}
        {props.speaking && (
          <button className="skip" onClick={() => voice.skip()}>
            {CAST[props.speaking.speaker].name.split(" ")[0]} is speaking · skip ⏭
          </button>
        )}
        {props.error && <div className="line err">{props.error}</div>}
        <div ref={end} />
      </div>
      <div className="input">
        <textarea
          rows={2}
          value={text}
          disabled={!canTalk}
          placeholder={
            props.phase === "pitch" ? "Type your pitch or answer… (Enter to send)" : props.phase === "termsheet" ? "Negotiate: counter, push back, ask what a clause means…" : props.phase === "huddle" ? "You're outside the room. Watch them decide." : ""
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="primary" disabled={!canTalk || !text.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const sorted = useMemo(() => [...entries].reverse(), [entries]);
  return (
    <div className="ledger-list">
      {sorted.length === 0 && <div className="muted">Waiting for the partners to start thinking…</div>}
      {sorted.map((e) => {
        const who = e.agent === "system" ? null : CAST[e.agent];
        return (
          <div key={e.id} className={`entry k-${e.kind}`}>
            <div className="entry-head">
              <span className="who" style={{ color: who?.color ?? "#a8a29e" }}>
                {who ? who.name.split(" ")[0] : "Room"}
                {e.to && <span className="to"> → {CAST[e.to].name.split(" ")[0]}</span>}
              </span>
              <span className="kind">{KIND_LABEL[e.kind]}</span>
              <span className="time">{Math.floor(e.t / 60000)}:{String(Math.floor(e.t / 1000) % 60).padStart(2, "0")}</span>
            </div>
            <div className="entry-text">{e.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function TermSheet({ terms, note, canSign, onSign }: { terms: Terms; note: string; canSign: boolean; onSign: () => void }) {
  const post = terms.pre_money + terms.raise_amount;
  const dil = terms.raise_amount / post;
  const rows: [string, string, boolean][] = [
    ["Raise", money(terms.raise_amount), false],
    ["Pre-money valuation", money(terms.pre_money), false],
    ["Investor ownership", `${(dil * 100).toFixed(1)}%`, dil > 0.2],
    ["Option pool (pre-money)", `${(terms.option_pool_pct * 100).toFixed(0)}%`, terms.option_pool_pct > 0.12],
    ["Liquidation preference", `${terms.liq_pref_multiple}x ${terms.participating ? "participating" : "non-participating"}`, terms.liq_pref_multiple > 1 || terms.participating],
    ["Board", `${terms.founder_board_seats} founder · ${terms.investor_board_seats} investor · ${terms.independent_board_seats} indep.`, terms.investor_board_seats >= terms.founder_board_seats],
    ["Pro rata", terms.pro_rata ? "Yes" : "No", false],
  ];
  return (
    <div className="termsheet">
      <div className="ts-title">
        TERM SHEET <span>Copperline Ventures</span>
      </div>
      {rows.map(([k, v, warn]) => (
        <div key={k} className="ts-row">
          <span>{k}</span>
          <b className={warn ? "warn" : ""}>{v}</b>
        </div>
      ))}
      {terms.other_clauses.length > 0 && (
        <ul className="clauses">
          {terms.other_clauses.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <div className="ts-note">{note}</div>
      {canSign && (
        <button className="sign" onClick={onSign}>
          Sign term sheet
        </button>
      )}
    </div>
  );
}

function DebriefView({ d, info, onAgain }: { d: Debrief; info: StartupInfo; onAgain: () => void }) {
  const s = d.scorecard;
  const tile = (label: string, value: unknown, sub?: string) => (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value === null || value === undefined ? "—" : String(value)}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
  return (
    <div className="debrief">
      <div className="debrief-card">
        <h2>Debrief · {info.company}</h2>
        <p className="verdict">{d.verdict}</p>
        {s ? (
          <div className="tiles">
            {tile("Outcome", String(s.outcome).replace("_", " "), `${s.invest_votes}/${s.total_votes} partners voted invest`)}
            {tile("You gave up", s.dilution_pct != null ? `${s.dilution_pct}%` : null, `Seed median ≈ ${s.benchmark_dilution_pct}% (Carta)`)}
            {tile("Pre-money", s.final_pre_money_m != null ? `$${s.final_pre_money_m}M` : null, `First offer $${s.first_offer_pre_money_m ?? "—"}M · 2026 seed median $${s.benchmark_seed_valuation_m}M`)}
            {tile("Your take at a $100M exit", s.founder_take_at_100m_m != null ? `$${s.founder_take_at_100m_m}M` : null, "Founders' share after preferences")}
            {tile("What the terms cost you", s.cost_of_terms_at_100m_m != null ? `$${s.cost_of_terms_at_100m_m}M` : null, "vs clean 1x non-participating at the same price")}
            {tile("Won in negotiation", s.founder_pct_won_in_negotiation != null ? `${s.founder_pct_won_in_negotiation} pts` : null, `${s.firm_concessions} firm concessions · ${s.founder_concessions} by you`)}
          </div>
        ) : (
          <div className="err">Bruin pipeline did not produce a scorecard. {d.bruin_log}</div>
        )}
        <h3>What the partners said about you</h3>
        <div className="feedback">
          {d.feedback.map((f, i) => (
            <div key={i} className="fb" style={{ borderColor: CAST[f.agent].color }}>
              <b style={{ color: CAST[f.agent].color }}>{CAST[f.agent].name}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
        {d.weak_spots.length > 0 && (
          <>
            <h3>The panel will remember (stored by Bruin)</h3>
            <div className="weak">
              {d.weak_spots.map((w) => (
                <span key={w.topic}>
                  {w.topic.replace(/_/g, " ")} <b>×{w.times}</b>
                </span>
              ))}
            </div>
          </>
        )}
        <details className="bruin-log">
          <summary>Bruin pipeline run {d.bruin_ok ? "✓" : "✗"}</summary>
          <pre>{d.bruin_log}</pre>
        </details>
        <button className="primary" onClick={onAgain}>
          Pitch again — they'll remember you
        </button>
      </div>
    </div>
  );
}
