import { useEffect, useMemo, useRef, useState } from "react";
import Room from "./Room";
import { CAST, SEAT_ORDER, portrait } from "./cast";
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

const KIND: Record<LedgerEntry["kind"], { label: string; icon: string }> = {
  thought: { label: "Private thought", icon: "◐" },
  stance: { label: "Opinion moved", icon: "↕" },
  whisper: { label: "Whisper", icon: "⟶" },
  fact_check: { label: "Fact-check", icon: "⌕" },
  weakness: { label: "Weak spot logged", icon: "!" },
  vote: { label: "Vote", icon: "✓" },
  decision: { label: "Decision", icon: "◆" },
  terms: { label: "Terms", icon: "§" },
  memory: { label: "Memory", icon: "◷" },
  system: { label: "Room", icon: "·" },
};

const money = (n: number) =>
  n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

// "$750K", "3m", "1.2 billion", "2,500,000" -> dollars; 0 when it can't be read.
export function parseAmount(text: string): number {
  const m = text.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|thousand|m|mm|mn|million|b|bn|billion)?$/);
  if (!m) return 0;
  const unit = m[2] ?? "";
  const mult = unit.startsWith("k") || unit === "thousand" ? 1e3 : unit.startsWith("m") ? 1e6 : unit.startsWith("b") ? 1e9 : 1;
  const v = parseFloat(m[1]) * mult;
  return v >= 1000 ? v : 0;
}
const STEPS: { phase: Phase[]; label: string }[] = [
  { phase: ["pitch"], label: "Pitch" },
  { phase: ["huddle"], label: "Partner meeting" },
  { phase: ["termsheet"], label: "Term sheet" },
  { phase: ["closed", "debrief"], label: "Debrief" },
];

export default function App() {
  const [info, setInfo] = useState<StartupInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  // What the 3D room shows: follows `phase`, but only after the lines spoken before the change have finished.
  const [roomPhase, setRoomPhase] = useState<Phase>("setup");
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
  const [filter, setFilter] = useState<"all" | "whisper" | "decisions">("all");
  const [showReport, setShowReport] = useState(true);

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
          // Leftover partner-meeting chatter is dropped once the founder is called back in.
          if (e.phase === "termsheet") voice.clearPending();
          setPhase(e.phase);
          voice.enqueueMarker(() => {
            setRoomPhase(e.phase);
            setPhaseNote(e.note ?? "");
          });
          break;
        case "agents":
          setAgents(Object.fromEntries(e.agents.map((a) => [a.id, a])) as Record<AgentId, AgentView>);
          break;
        case "ledger":
          setLedger((l) => (l.some((x) => x.id === e.entry.id) ? l : [...l, e.entry]));
          break;
        case "speak":
          setLines((l) => [...l, e.line]);
          voice.enqueue(e.line, e.audio);
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
          setShowReport(true);
          break;
        case "error":
          setError(e.message);
          break;
      }
    };
    return () => es.close();
  }, [sessionId]);

  async function start(i: StartupInfo) {
    voice.unlock(); // runs inside the click, so the browser allows the voices that follow
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
    setRoomPhase("pitch");
  }

  if (phase === "setup" || !info) return <Landing onStart={start} error={error} />;

  const stepIndex = STEPS.findIndex((s) => s.phase.includes(roomPhase));
  return (
    <div className="layout">
      <div className="stage">
        <Room agents={agents} phase={roomPhase} speaking={speaking} terms={terms} />
        <header className="topbar">
          <div className="logo">
            <span className="logo-mark" />
            Behind the Glass <em>· {info.company}</em>
          </div>
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s.label} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>
                <span>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <button className="ghost" onClick={() => setMuted((m) => !m)} aria-label="Toggle voices">
            {muted ? "Voices off" : "Voices on"}
          </button>
        </header>
        <PanelStrip agents={agents} speaking={speaking?.speaker ?? null} />
        {phaseNote && roomPhase === "huddle" && <div className="glass-note">{phaseNote}</div>}
        {terms && (roomPhase === "termsheet" || roomPhase === "closed") && (
          <TermSheet terms={terms} note={termsNote} canSign={phase === "termsheet" && !busy} onSign={() => fetch(`/api/session/${sessionId}/sign`, { method: "POST" })} />
        )}
        <Composer
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
        {/* The report opens once the last voice line has finished, never over someone talking. */}
        {debrief && !speaking && showReport && (
          <DebriefView d={debrief} info={info} ledger={ledger} onAgain={() => start(info)} onClose={() => setShowReport(false)} />
        )}
        {debrief && !speaking && !showReport && (
          <button className="primary view-report" onClick={() => setShowReport(true)}>
            View debrief
          </button>
        )}
      </div>
      <aside className="ledger">
        <div className="ledger-head">
          <div className="live">
            <span className="pulse" /> Live
          </div>
          <h2>Decision ledger</h2>
          <p>What every investor privately thinks, whispers and decides.</p>
          <div className="chips">
            {(
              [
                ["all", "Everything"],
                ["whisper", "Whispers"],
                ["decisions", "Votes & decisions"],
              ] as const
            ).map(([f, label]) => (
              <button key={f} className={filter === f ? "chip-btn on" : "chip-btn"} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Ledger
          entries={ledger.filter((e) =>
            filter === "all" ? true : filter === "whisper" ? e.kind === "whisper" : ["vote", "decision", "terms", "memory"].includes(e.kind),
          )}
        />
      </aside>
    </div>
  );
}

function Avatar({ id, size = 32, ring }: { id: AgentId; size?: number; ring?: boolean }) {
  return (
    <img
      className={ring ? "avatar ring" : "avatar"}
      src={portrait(id)}
      alt={CAST[id].name}
      width={size}
      height={size}
      style={{ ["--c" as string]: CAST[id].color, width: size, height: size }}
    />
  );
}

function PanelStrip({ agents, speaking }: { agents: Record<AgentId, AgentView>; speaking: AgentId | null }) {
  return (
    <div className="panel-strip">
      {SEAT_ORDER.map((id) => {
        const v = agents[id];
        const pct = (v.stance + 100) / 2;
        const tone = v.stance > 25 ? "good" : v.stance < -25 ? "bad" : "mid";
        return (
          <div key={id} className={`pcard ${speaking === id ? "speaking" : ""} ${v.thinking ? "thinking" : ""}`} style={{ ["--c" as string]: CAST[id].color }}>
            <Avatar id={id} size={40} ring />
            <div className="pcard-body">
              <div className="pcard-name">{CAST[id].name}</div>
              <div className="pcard-role">{v.thinking ? "thinking…" : speaking === id ? "speaking" : CAST[id].role}</div>
              <div className="stance" title={`Opinion ${v.stance}`}>
                <div className={`stance-fill ${tone}`} style={{ width: `${pct}%` }} />
                <div className="stance-mid" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Landing({ onStart, error }: { onStart: (i: StartupInfo) => void; error: string | null }) {
  const [f, setF] = useState<StartupInfo>({ founder_name: "", company: "", one_liner: "", stage: "", raise_amount: 0, traction: "", extra: "" });
  const [raiseText, setRaiseText] = useState("");
  const set = (k: keyof StartupInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const raise = parseAmount(raiseText);
  const formRef = useRef<HTMLDivElement>(null);
  const go = () => formRef.current?.scrollIntoView({ behavior: "smooth" });
  return (
    <div className="landing">
      <nav className="lnav">
        <div className="logo">
          <span className="logo-mark" />
          Behind the Glass
        </div>
        <button className="ghost" onClick={go}>
          Start a meeting
        </button>
      </nav>
      <section className="hero">
        <div className="eyebrow">Hear what investors say after you leave the room</div>
        <h1>
          Rehearse the raise
          <br />
          <span>before it's real.</span>
        </h1>
        <p className="lede">
          Pitch seven AI investors at their Monday partner meeting. They question you, fact-check you live, debate you behind the glass and
          vote. If they bite, you negotiate the term sheet — then see exactly what your deal would cost you.
        </p>
        <div className="hero-cta">
          <button className="primary lg" onClick={go}>
            Walk into the room
          </button>
          <span className="hint">Typed answers · voices on · about 10 minutes</span>
        </div>
        <div className="faces">
          {SEAT_ORDER.map((id) => (
            <figure key={id} style={{ ["--c" as string]: CAST[id].color }}>
              <img src={portrait(id)} alt={CAST[id].name} />
              <figcaption>
                <b>{CAST[id].name}</b>
                <span>{CAST[id].role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="facts">
        <div>
          <b>100–200</b>
          <span>investor conversations to close a typical seed round</span>
          <a href="https://www.techstars.com/blog/founder-advice/the-founders-guide-to-fundraising-rejection" target="_blank" rel="noreferrer">
            Techstars
          </a>
        </div>
        <div>
          <b>0.2%</b>
          <span>of pitch decks one VC reviewed turned into a check</span>
          <a href="https://carta.com/data/linkedin-pitch-deck-to-funding-rate-vc/" target="_blank" rel="noreferrer">
            Carta
          </a>
        </div>
        <div>
          <b>$19.7M</b>
          <span>median seed valuation in 2026 — the bar your deal is scored against</span>
          <a href="https://carta.com/data/state-of-private-markets-q3-2026-full-report/" target="_blank" rel="noreferrer">
            Carta
          </a>
        </div>
      </section>
      <section className="how">
        {[
          ["01", "Pitch", "Type your pitch. Seven investors think in parallel; the most urgent interrupts — out loud."],
          ["02", "Behind the glass", "You step out. Watch the partners argue, whisper and vote on you."],
          ["03", "Term sheet", "Negotiate valuation, preferences, board seats and the option pool."],
          ["04", "Debrief", "Bruin prices your deal against Carta benchmarks. The panel remembers you next time."],
        ].map(([n, t, d]) => (
          <div key={n}>
            <span>{n}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>
      <section className="setup-card" ref={formRef}>
        <h2>Your startup</h2>
        <p className="muted">Use the same name next time — the panel will remember your weak spots.</p>
        <div className="grid2">
          <label>
            Your name
            <input value={f.founder_name} onChange={set("founder_name")} />
          </label>
          <label>
            Company
            <input value={f.company} onChange={set("company")} />
          </label>
        </div>
        <label>
          One-liner
          <input value={f.one_liner} onChange={set("one_liner")} placeholder="What you do, for whom" />
        </label>
        <div className="grid2">
          <label>
            Stage
            <select value={f.stage} onChange={set("stage")} className={f.stage ? "" : "placeholder"}>
              <option value="" disabled>
                Select stage
              </option>
              <option value="pre-seed">Pre-seed</option>
              <option value="seed">Seed</option>
              <option value="series-a">Series A</option>
              <option value="series-b">Series B</option>
              <option value="series-c+">Series C+</option>
            </select>
          </label>
          <label>
            How much are you raising?
            <input value={raiseText} onChange={(e) => setRaiseText(e.target.value)} placeholder="e.g. $750K, $3M, $1.2B" />
            {raiseText && !raise && <span className="hint-err">Try a format like $750K, $3M or $1.2B</span>}
          </label>
        </div>
        <label>
          Traction
          <textarea rows={2} value={f.traction} onChange={set("traction")} placeholder="Revenue, users, growth, pilots…" />
        </label>
        <label>
          Anything else the panel should know
          <textarea rows={2} value={f.extra} onChange={set("extra")} />
        </label>
        {error && <div className="err">{error}</div>}
        <button
          className="primary lg"
          disabled={!f.founder_name || !f.company || !f.one_liner || !f.stage || !raise}
          onClick={() => onStart({ ...f, raise_amount: raise })}
        >
          Walk into the room →
        </button>
      </section>
      <footer className="lfoot">
        Built at the Finch Multiplayer AI Hackathon · Agents by Claude · Scoring and memory by Bruin · Portraits and voices by Runware · Fact-checks by Telem · Diligence by Glasser · Partner channel on BAND · Copperline Ventures
        is fictional.
      </footer>
    </div>
  );
}

function Composer(props: {
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
  const [showLog, setShowLog] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.lines.length, showLog]);
  // The founder answers once the partners have finished talking (or skips ahead).
  const canTalk = (props.phase === "pitch" || props.phase === "termsheet") && !props.busy && !props.speaking;
  const lastFounder = [...props.lines].reverse().find((l) => l.speaker === "founder");
  async function send() {
    const t = text.trim();
    if (!t || !canTalk) return;
    setText("");
    props.setError(null);
    const r = await fetch(`/api/session/${props.sessionId}/say`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
    if (!r.ok) props.setError((await r.json()).error ?? "Could not send");
  }
  return (
    <div className={props.narrow ? "composer narrow" : "composer"}>
      {showLog && (
        <div className="transcript">
          {props.lines.map((l, i) => (
            <div key={i} className={l.speaker === "founder" ? "tline me" : "tline"}>
              <b style={{ color: l.speaker === "founder" ? undefined : CAST[l.speaker].color }}>{l.speaker === "founder" ? props.founder : CAST[l.speaker].name}</b>
              {l.text}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      {props.speaking ? (
        <div className="caption" style={{ ["--c" as string]: CAST[props.speaking.speaker].color }}>
          <Avatar id={props.speaking.speaker} size={44} ring />
          <div>
            <div className="caption-who">
              {CAST[props.speaking.speaker].name} <span>{CAST[props.speaking.speaker].role}</span>
            </div>
            <div className="caption-text">{props.speaking.text}</div>
          </div>
          <button className="skip" onClick={() => voice.skip()}>
            Skip ›
          </button>
        </div>
      ) : props.busy ? (
        <div className="caption muted-cap">
          <span className="spinner" /> {props.busy}
        </div>
      ) : lastFounder && props.phase !== "huddle" ? (
        <div className="caption muted-cap">
          You: “{lastFounder.text.slice(0, 140)}
          {lastFounder.text.length > 140 ? "…" : ""}”
        </div>
      ) : null}
      {props.error && <div className="err">{props.error}</div>}
      <div className="input">
        <textarea
          rows={2}
          value={text}
          disabled={!canTalk}
          placeholder={
            props.phase === "pitch"
              ? "Type your pitch or answer…   Enter to send"
              : props.phase === "termsheet"
                ? "Negotiate: counter, push back, ask what a clause means…"
                : props.phase === "huddle"
                  ? "You're outside the room. Watch them decide."
                  : ""
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="input-actions">
          <button className="ghost sm" onClick={() => setShowLog((s) => !s)}>
            {showLog ? "Hide transcript" : "Transcript"}
          </button>
          <button className="primary" disabled={!canTalk || !text.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const sorted = useMemo(() => [...entries].reverse(), [entries]);
  return (
    <div className="ledger-list">
      {sorted.length === 0 && <div className="muted pad">Waiting for the partners to start thinking…</div>}
      {sorted.map((e) => {
        const who = e.agent === "system" ? null : CAST[e.agent];
        return (
          <div key={e.id} className={`entry k-${e.kind}`} style={{ ["--c" as string]: who?.color ?? "#78716c" }}>
            {e.agent !== "system" ? <Avatar id={e.agent} size={28} /> : <span className="sys-dot">{KIND[e.kind].icon}</span>}
            <div className="entry-main">
              <div className="entry-head">
                <span className="who">{who ? who.name.split(" ")[0] : "Room"}</span>
                {e.to && (
                  <span className="to">
                    → <Avatar id={e.to} size={16} /> {CAST[e.to].name.split(" ")[0]}
                  </span>
                )}
                <span className="kind">
                  {KIND[e.kind].icon} {KIND[e.kind].label}
                </span>
                <span className="time">
                  {Math.floor(e.t / 60000)}:{String(Math.floor(e.t / 1000) % 60).padStart(2, "0")}
                </span>
              </div>
              <div className="entry-text">{e.text}</div>
            </div>
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
    ["Investment", money(terms.raise_amount), false],
    ["Pre-money valuation", money(terms.pre_money), false],
    ["Investor ownership", `${(dil * 100).toFixed(1)}%`, dil > 0.2],
    ["Option pool (pre-money)", `${(terms.option_pool_pct * 100).toFixed(0)}%`, terms.option_pool_pct > 0.12],
    ["Liquidation preference", `${terms.liq_pref_multiple}x ${terms.participating ? "participating" : "non-participating"}`, terms.liq_pref_multiple > 1 || terms.participating],
    ["Board", `${terms.founder_board_seats} founder · ${terms.investor_board_seats} investor · ${terms.independent_board_seats} indep.`, terms.investor_board_seats >= terms.founder_board_seats],
    ["Pro rata rights", terms.pro_rata ? "Yes" : "No", false],
  ];
  return (
    <div className="termsheet">
      <div className="ts-head">
        <div>
          <div className="ts-kicker">Summary of terms · Series Seed Preferred</div>
          <div className="ts-firm">Copperline Ventures</div>
        </div>
        <div className="ts-note">{note}</div>
      </div>
      {rows.map(([k, v, warn]) => (
        <div key={k} className="ts-row">
          <span>{k}</span>
          <b className={warn ? "warn" : ""}>
            {warn && <i title="Worse than standard founder-friendly terms">▲ </i>}
            {v}
          </b>
        </div>
      ))}
      {terms.other_clauses.length > 0 && (
        <ul className="clauses">
          {terms.other_clauses.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {canSign && (
        <button className="sign" onClick={onSign}>
          Sign term sheet
        </button>
      )}
    </div>
  );
}

/* ---------- Debrief: an investor-report style read-out ---------- */

const EXIT_COLORS = { clean: "#3987e5", yours: "#d95926" }; // validated dark-mode categorical slots 1–2

function ExitChart({ rows }: { rows: Debrief["waterfall"] }) {
  const data = rows.filter((r) => r.version === "final");
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="muted">No signed terms to price.</div>;
  const W = 520, H = 220, L = 52, B = 30, T = 14, R = 12;
  const max = Math.max(...data.map((d) => d.founder_take_clean_terms));
  const x = (i: number) => L + (i + 0.5) * ((W - L - R) / data.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bw = Math.min(34, (W - L - R) / data.length / 3);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const label = (v: number) => (v >= 1e9 ? `$${v / 1e9}B` : `$${v / 1e6}M`);
  return (
    <div className="chart">
      <div className="chart-legend">
        <span>
          <i style={{ background: EXIT_COLORS.clean }} /> Clean 1x terms, same price
        </span>
        <span>
          <i style={{ background: EXIT_COLORS.yours }} /> Your terms
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Founder payout by exit value, your terms versus clean terms">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">
              ${(t / 1e6).toFixed(0)}M
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.exit_value} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x(i) - bw - 1} y={T} width={bw * 2 + 2} height={H - T - B} fill="transparent" />
            <rect x={x(i) - bw - 1} y={y(d.founder_take_clean_terms)} width={bw} height={H - B - y(d.founder_take_clean_terms)} rx={4} fill={EXIT_COLORS.clean} />
            <rect x={x(i) + 1} y={y(d.founder_take)} width={bw} height={H - B - y(d.founder_take)} rx={4} fill={EXIT_COLORS.yours} />
            <text x={x(i)} y={H - 10} textAnchor="middle" className="axis">
              {label(d.exit_value)} exit
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="tooltip">
          At a {label(data[hover].exit_value)} exit founders take <b>${(data[hover].founder_take / 1e6).toFixed(2)}M</b> vs $
          {(data[hover].founder_take_clean_terms / 1e6).toFixed(2)}M on clean terms
        </div>
      )}
    </div>
  );
}

// Where each partner started and ended, plus how they voted: a dumbbell per partner on one shared -100..+100 scale.
function finalStances(ledger: LedgerEntry[]) {
  return SEAT_ORDER.map((id) => {
    const moves = ledger.filter((e) => e.agent === id && e.kind === "stance" && e.stance !== undefined);
    const votes = ledger.filter((e) => e.agent === id && e.kind === "vote");
    const vote = votes.length ? (votes[votes.length - 1].text.split(" ")[0] ?? "").toUpperCase() : "";
    return { id, start: id === "point" ? 30 : 0, end: moves.length ? moves[moves.length - 1].stance! : id === "point" ? 30 : 0, vote, moves: moves.length };
  });
}

function OpinionShift({ ledger }: { ledger: LedgerEntry[] }) {
  const rows = finalStances(ledger);
  const x = (v: number) => 50 + v / 2; // percent across the track
  return (
    <div className="shift">
      <div className="shift-scale">
        <span>Hard pass −100</span>
        <span>Neutral</span>
        <span>Must invest +100</span>
      </div>
      {rows.map((r) => {
        const tone = r.end > 25 ? "good" : r.end < -25 ? "bad" : "mid";
        const lo = Math.min(x(r.start), x(r.end));
        const hi = Math.max(x(r.start), x(r.end));
        return (
          <div key={r.id} className="shift-row" title={`${CAST[r.id].name}: ${r.start} → ${r.end} over ${r.moves} opinion changes${r.vote ? ` · voted ${r.vote}` : ""}`}>
            <div className="shift-who">
              <Avatar id={r.id} size={24} />
              <span>{CAST[r.id].name.split(" ")[0]}</span>
            </div>
            <div className="shift-track">
              <div className="shift-zero" />
              <div className={`shift-bar ${tone}`} style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 0.6)}%` }} />
              <div className="shift-start" style={{ left: `${x(r.start)}%` }} />
              <div className={`shift-end ${tone}`} style={{ left: `${x(r.end)}%` }} />
            </div>
            <div className={`shift-val ${tone}`}>{r.end > 0 ? `+${r.end}` : r.end}</div>
            <div className={`shift-vote ${r.vote === "INVEST" ? "good" : r.vote === "PASS" ? "bad" : ""}`}>{r.vote ? (r.vote === "INVEST" ? "✓ Invest" : r.vote === "PASS" ? "✕ Pass" : "? Undecided") : "—"}</div>
          </div>
        );
      })}
      <div className="shift-legend">
        <span>
          <i className="dot-start" /> start of meeting
        </span>
        <span>
          <i className="dot-end" /> end of meeting
        </span>
      </div>
    </div>
  );
}

function SimulationNote({ sim }: { sim: Debrief["simulation"] }) {
  const fin = sim.find((r) => r.version === "final");
  const first = sim.find((r) => r.version === "first_offer");
  if (!fin) return null;
  return (
    <div className="sim">
      <b>{fin.simulations.toLocaleString()} simulated exits</b> (Bruin · Python Monte Carlo): your final terms leave the founders with nothing in{" "}
      <b>{fin.wipeout_pct.toFixed(0)}%</b> of outcomes
      {first && first.wipeout_pct !== fin.wipeout_pct ? <> (the first offer: {first.wipeout_pct.toFixed(0)}%)</> : null}, and cost you{" "}
      <b>${(fin.mean_cost_of_terms / 1e6).toFixed(2)}M</b> on average versus clean terms. Median founder take:{" "}
      <b>${(fin.p50_take / 1e6).toFixed(1)}M</b>.
    </div>
  );
}

function DebriefView({ d, info, ledger, onAgain, onClose }: { d: Debrief; info: StartupInfo; ledger: LedgerEntry[]; onAgain: () => void; onClose: () => void }) {
  const s = d.scorecard;
  const tile = (label: string, value: unknown, sub?: string, tone?: "good" | "bad") => (
    <div className={`tile ${tone ?? ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value === null || value === undefined ? "—" : String(value)}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
  const dil = s?.dilution_pct as number | null | undefined;
  const dealDone = s?.final_pre_money_m != null;
  const rows = finalStances(ledger);
  const fan = [...rows].sort((a, b) => b.end - a.end)[0];
  const critic = [...rows].sort((a, b) => a.end - b.end)[0];
  const factChecks = ledger.filter((e) => e.kind === "fact_check").length;
  const bench = s?.benchmark_dilution_pct as number | undefined;
  return (
    <div className="debrief">
      <div className="report">
        <div className="report-head">
          <div>
            <div className="eyebrow">Partner meeting debrief · {info.company}</div>
            <h2>{d.verdict || "The meeting is over."}</h2>
          </div>
          <div className="report-actions">
            <button className="ghost" onClick={onClose}>
              Back to the room
            </button>
            <button className="primary" onClick={onAgain}>
              Pitch again — they'll remember you
            </button>
          </div>
        </div>
        {s ? (
          <div className="tiles">
            {tile("Outcome", String(s.outcome).replace("_", " ").replace(/^./, (c) => c.toUpperCase()), `${s.invest_votes} of ${s.total_votes} partners voted to invest`)}
            {!dealDone && tile("Strongest supporter", `${CAST[fan.id].name.split(" ")[0]} ${fan.end > 0 ? "+" : ""}${fan.end}`, CAST[fan.id].role, "good")}
            {!dealDone && tile("Toughest critic", `${CAST[critic.id].name.split(" ")[0]} ${critic.end > 0 ? "+" : ""}${critic.end}`, CAST[critic.id].role, critic.end < 0 ? "bad" : undefined)}
            {!dealDone && tile("Weak spots logged", s.weak_spots_logged, "Claims the partners flagged as thin")}
            {!dealDone && tile("Fact-checks run", factChecks, "Live web checks (Telem) and diligence (Glasser)")}
            {!dealDone && tile("Opinion change", `${rows.reduce((t, r) => t + r.end - r.start, 0) > 0 ? "+" : ""}${rows.reduce((t, r) => t + r.end - r.start, 0)}`, "Sum of all seven partners' moves")}
            {dealDone && tile("You gave up", dil != null ? `${dil}%` : null, `Seed median ≈ ${bench}% (Carta)`, dil != null && bench != null ? (dil <= bench ? "good" : "bad") : undefined)}
            {dealDone && tile("Pre-money", s.final_pre_money_m != null ? `$${s.final_pre_money_m}M` : null, `First offer $${s.first_offer_pre_money_m ?? "—"}M · 2026 median $${s.benchmark_seed_valuation_m}M`)}
            {dealDone && tile("Your take at a $100M exit", s.founder_take_at_100m_m != null ? `$${s.founder_take_at_100m_m}M` : null, "Founders' share after preferences")}
            {dealDone && tile(
              "What the terms cost you",
              s.cost_of_terms_at_100m_m != null ? `$${s.cost_of_terms_at_100m_m}M` : null,
              "vs clean 1x non-participating at the same price",
              s.cost_of_terms_at_100m_m == null ? undefined : Number(s.cost_of_terms_at_100m_m) > 0 ? "bad" : "good",
            )}
            {dealDone && tile("Won in negotiation", s.founder_pct_won_in_negotiation != null ? `+${s.founder_pct_won_in_negotiation} pts` : null, `${s.firm_concessions} concessions by the firm · ${s.founder_concessions} by you`)}
          </div>
        ) : (
          <div className="muted">The Bruin pipeline did not produce a scorecard for this session — details below.</div>
        )}
        <SimulationNote sim={d.simulation} />
        <div className={d.waterfall.some((r) => r.version === "final") ? "report-grid" : "report-grid single"}>
          {d.waterfall.some((r) => r.version === "final") ? (
            <section>
              <h3>What your terms pay you at exit</h3>
              <ExitChart rows={d.waterfall} />
            </section>
          ) : (
            <section className="passed">
              <h3>No term sheet</h3>
              <p>
                The partnership passed, so there are no terms to price. Fix what they flagged below and pitch again — the panel will
                open with your old weak spots.
              </p>
            </section>
          )}
          <section>
            <h3>How each partner's opinion moved</h3>
            <OpinionShift ledger={ledger} />
          </section>
        </div>
        <h3>What the partners said about you</h3>
        <div className="feedback">
          {d.feedback.map((f, i) => (
            <div key={i} className="fb" style={{ ["--c" as string]: CAST[f.agent].color }}>
              <Avatar id={f.agent} size={36} ring />
              <div>
                <b>{CAST[f.agent].name}</b>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
        {d.weak_spots.length > 0 && (
          <>
            <h3>The panel will remember</h3>
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
          <summary>Scored by the Bruin pipeline {d.bruin_ok ? "· all checks passed" : "· see run log"}</summary>
          <pre>{d.bruin_log}</pre>
        </details>
      </div>
    </div>
  );
}
