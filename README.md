<p align="center">
  <img src="docs/assets/banner.svg" alt="Behind the Glass: pitch seven AI investors, watch them decide, negotiate the term sheet" width="100%" />
</p>

<p align="center">
  <img alt="Finch Multiplayer AI Hackathon" src="https://img.shields.io/badge/Finch_Hackathon-Track_3%3A_Grow_with_Agents-fbbf24?style=flat-square" />
  <img alt="7 agents" src="https://img.shields.io/badge/agents-7_autonomous-34d399?style=flat-square" />
  <img alt="Bruin" src="https://img.shields.io/badge/data-Bruin_%2B_DuckDB-a78bfa?style=flat-square" />
  <img alt="Claude" src="https://img.shields.io/badge/LLM-Claude-f472b6?style=flat-square" />
  <img alt="React Three Fiber" src="https://img.shields.io/badge/3D-React_Three_Fiber-38bdf8?style=flat-square" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-e5e7eb?style=flat-square" />
</p>

<p align="center"><b>A flight simulator for fundraising.</b><br/>
Pitch seven AI investors at their Monday partner meeting. They question you, fact-check you live, debate you behind the glass and vote.
If they bite, you negotiate a real term sheet. Then a Bruin pipeline prices your deal against real market data — and the panel remembers you next time.</p>

---

## The problem

- **Every bad pitch burns a real investor.** Founders typically need **100–200 investor conversations** to close a seed round ([Techstars](https://www.techstars.com/blog/founder-advice/the-founders-guide-to-fundraising-rejection)); one VC saw **11 checks from ~4,500 decks** ([Carta](https://carta.com/data/linkedin-pitch-deck-to-funding-rate-vc/)).
- **Founders lose the most in the fine print.** First-time founders often don't grasp liquidation preferences and over-focus on valuation ([SVB](https://www.svb.com/startup-insights/raising-capital/read-startup-term-sheet/)); losing board control means you can be fired from your own company ([YC](https://www.ycombinator.com/blog/a-standard-and-clean-series-a-term-sheet/)).
- **Practice tools stop at the pitch.** Existing AI pitch coaches are one AI giving a score. None show what investors say after you leave the room, and none negotiate the deal with you.

## What it does

| | |
|---|---|
| **🎤 Pitch & Q&A** | Type your pitch. Seven investors think in parallel; the most urgent ones interrupt, out loud, each with their own voice. Opinion meters over their heads move as you talk. |
| **🔎 Live fact-checks** | The associate checks your claims on the web and whispers what he found to the devil's advocate. |
| **🪟 Behind the glass** | The managing partner sends you out. The partners walk to the corner, argue for two rounds and vote — you watch it all. |
| **📝 Term sheet** | The managing partner sets terms from the debate: valuation, liquidation preference, participation, option pool, board, pro rata, clauses. Negotiate; the partners whisper strategy and concede or hold. |
| **📊 Debrief** | Bruin scores your deal: dilution vs the Carta seed median, what the terms cost you at a $100M exit, what you won in negotiation, plus feedback that quotes your own words. |
| **🧠 Memory** | Come back with the same name and the panel opens with your old weak spots. |

<p align="center">
  <img src="docs/assets/room.png" alt="The 3D partner meeting room with seven investors" width="100%" />
</p>

## The seven agents

Each investor is its own Claude agent with a **private goal**. Every turn, each one independently decides what it thinks, how far its opinion moves, whether to speak, who to whisper to, how to gesture, which weak spot to log, and (associate) what to fact-check. The orchestrator only hands the floor to whoever wants it most — it never writes their lines. Every decision lands in the **decision ledger**.

| | Agent | Role | Private goal |
|---|---|---|---|
| 🟢 | Priya Raman | Point partner | Brought you in; wants the deal, won't defend dodged answers |
| 🟡 | Harold Voss | Managing partner | Final say, protects the fund, calls the partner meeting |
| 🩷 | Maya Chen | Numbers partner | Real metrics; pushes valuation to what they support |
| 🟣 | Dev Okafor | Product & market | Why now, competitors, moat |
| 🔴 | Rex Calloway | Devil's advocate | Find the reason to say no |
| 🔵 | Sam Lindqvist | Associate | Fact-checks your claims on the web, whispers findings |
| ⚪ | Elena Brooks | General counsel | Protects the firm in the fine print; joins for the term sheet |

The cast mirrors real partner meetings: a sponsoring partner, the full partnership, an associate who did the diligence and counsel ([First Round Review](https://review.firstround.com/heres-what-you-can-really-expect-when-pitching-your-seed-stage-startup-at-a-vc-behind-the-glass/)).

## How it works

```mermaid
flowchart TD
  F([Founder types]) --> T
  subgraph T[Every turn]
    direction TB
    A1[7 agents think in parallel<br/>own goal · memory · whispers] --> D[Structured decisions<br/>stance · urgency · say · gesture<br/>whisper · weak spot · fact-check]
    D --> L[(Decision ledger)]
    D --> S[Most urgent agent<br/>gets the floor]
  end
  S --> V[3D room<br/>voices · gestures · meters]
  T -->|managing partner<br/>calls the meeting| H[Partner meeting<br/>2 debate rounds + vote]
  H -->|invest| TS[Term sheet<br/>negotiation rounds]
  H -->|pass| DB
  TS -->|sign / walk away| DB[Session JSON]
  DB --> B[[Bruin pipeline<br/>DuckDB]]
  B --> SC[Scorecard + feedback]
  B --> M[Founder profile]
  M -.->|memory next session| A1
```

### Bruin pipeline

```mermaid
flowchart LR
  J[data/sessions/*.json] --> S[pm.sessions]
  C[carta_benchmarks.csv<br/>seed, cited sources] --> CB[pm.carta_benchmarks]
  S --> TO[pm.term_outcomes<br/>cap-table math]
  TO --> EW[pm.exit_waterfall<br/>founder take at $20M–$500M]
  S --> W[pm.weak_spots]
  S & TO & EW & CB --> SC[pm.scorecard]
  SC & CB --> FP[pm.founder_profile]
  FP -.-> AG((agents' memory))
```

Assets carry Bruin quality checks (`not_null`, `unique`, `accepted_values`, `non_negative`). Benchmarks used: 2026 median seed valuation ~$19.7M ([Carta Q3 2026](https://carta.com/data/state-of-private-markets-q3-2026-full-report/)), seed dilution ~19% ([Carta 2025](https://www.carta.com/data/state-of-private-markets-q4-2025)), clean terms = 1x non-participating ([YC](https://www.ycombinator.com/blog/a-standard-and-clean-series-a-term-sheet/)).

## Quick start

You need Node 22+, the [Bruin CLI](https://getbruin.com) and an [Anthropic API key](https://console.anthropic.com). Chrome or Edge give the best voices. No microphone needed.

```bash
curl -LsSf https://getbruin.com/install/cli | sh
```

```bash
git clone https://github.com/ChinmayPatel07/finch-hack && cd finch-hack/app && npm install && cp .env.example .env
```

Add your key to `app/.env`, then:

```bash
npm run dev
```

Open **http://localhost:5173**, fill in your startup and walk into the room.

<p align="center">
  <img src="docs/assets/setup.png" alt="Setup screen" width="80%" />
</p>

## Built with

| Layer | Tech |
|---|---|
| Agents | Claude API — structured outputs (zod), server-side web search for fact-checks, refusal fallbacks |
| Server | Node 22, Express, Server-Sent Events |
| 3D | React, Three.js, React Three Fiber, drei |
| Voices | Browser speech synthesis, one voice per agent |
| Data | **Bruin** pipeline on DuckDB (seed + SQL assets + quality checks) |

## Hackathon checklist

| Requirement | How |
|---|---|
| Track 3: agents in expert roles as visible characters | Seven VC partners in a 3D room |
| 2–3+ agents coordinate about the human | Whispers, partner debate and vote, negotiation strategy |
| Agents adapt to how the human performs | Stances drive questions, the vote and the terms |
| Clear result with evidence-based feedback | Bruin scorecard vs Carta + feedback quoting the founder |
| ≥3 agents with own goals · characters that move · visible decisions | 7 agents with private goals · walking, gesturing avatars · live decision ledger |
| Bonus: 3D · voice · memory that changes decisions | All three |
| Bruin (mandatory) | Scores every session and stores the panel's memory |

## Repository

```
app/      React + Three.js frontend and the Node agent engine (see docs/ARCHITECTURE.md)
bruin/    Bruin pipeline: Carta seed, SQL assets, quality checks
docs/     Plan, research with sources, architecture, images
```

```bash
cd app && npm run typecheck && npm test && npm run build
```

Tests run offline: a whole session (pitch → partner meeting → term sheet → debrief) with a test double for the model, and every Bruin SQL asset on DuckDB against a fixture.

## What's next

- Upload a pitch deck and let the panel read it
- Pick a real fund's thesis to pitch against
- Series A mode (bigger panel, tougher terms)
- Sponsor integrations: Runware-generated partner portraits, BAND for the private partner channel, Telem for live web data

---

<sub>Built solo in one day at the Finch Multiplayer AI Hackathon, Nov 23 2026. Copperline Ventures and its partners are fictional. This is a practice tool, not legal or financial advice.</sub>
