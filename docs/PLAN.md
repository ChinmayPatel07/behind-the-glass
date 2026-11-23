# Plan — Partner Meeting

**Event:** Finch Multiplayer AI Hackathon (Thanksgiving Special), Nov 23 2026, AWS Builder Loft SF (participating remotely).
**Track:** 3 — Grow with Agents. **Deadline:** submit by 6:00 PM PT.

## Idea
A founder rehearses a whole seed round against seven AI investors at a VC partner meeting:
pitch → live Q&A + fact-checks → private partner debate and vote (watched through the glass) →
term sheet negotiation → debrief that prices the deal against real Carta benchmarks. The panel remembers you next time.

## Cast (each agent has its own private goal)
| Agent | Role |
|---|---|
| Priya Raman | Point partner — sponsors you |
| Harold Voss | Managing partner — final say, calls the partner meeting |
| Maya Chen | Numbers partner — metrics, valuation |
| Dev Okafor | Product & market partner |
| Rex Calloway | Devil's advocate |
| Sam Lindqvist | Associate — live web fact-checks, whispers findings |
| Elena Brooks | General counsel — joins for the term sheet |

## Pipeline
Browser (React Three Fiber room, ledger, voices) ⇄ Node orchestrator (7 parallel Claude agents, structured decisions, web-search fact-checks)
→ session JSON → **Bruin** (DuckDB): `pm.sessions` → `pm.term_outcomes` → `pm.exit_waterfall` → `pm.scorecard`, `pm.weak_spots` → `pm.founder_profile` → agents' memory next session.

## Status
| Piece | Status |
|---|---|
| Repo + agent rules | done |
| Agent engine (7 agents, pitch → huddle → term sheet → debrief) | done; flow tested offline; live run with API key pending |
| 3D room, avatars, gestures, opinion meters, speech bubbles | done |
| Decision ledger | done |
| Voices (browser TTS, one voice per agent); typed input (no mic) | done |
| Bruin pipeline (SQL tested on DuckDB, format checked against Bruin docs) | done; first `bruin run` on laptop pending |
| Tests + CI (typecheck, offline flow test, Bruin SQL test, build) | done |
| README, architecture doc, license | done |
| Live run on laptop with key | todo |
| Sponsor extras: Runware portraits, BAND channel, Telem fact-check | stretch |
| AdaL demo video, README screenshots, submission | todo |

## Submission checklist
- [ ] Public repo
- [ ] Demo video (AdaL)
- [ ] Submitted on hackathons.crewbasecollective.com before 6 PM PT
