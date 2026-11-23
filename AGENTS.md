# Agent entry point — Behind the Glass

Solo hackathon build (Finch "Multiplayer AI" hackathon, Track 3: Grow with Agents).
Read this file, then `docs/ARCHITECTURE.md` (how the code works) and `docs/PLAN.md` (status).
Research and sources are in `docs/RESEARCH.md`.

## Hackathon rules we must keep
- All code written during the event (from 2026-11-23). Libraries and APIs are fine.
- **Bruin is mandatory** — the `bruin/` pipeline must stay in the product path (it scores sessions and is the agents' memory).
- At least 3 agents with their own goals, visual characters that move, visible decisions (the ledger).
- Submit a public repo link + demo before 6:00 PM PT at hackathons.crewbasecollective.com. Demo video edited in AdaL.

## Working rules
- One change = one branch (`feat/…`, `fix/…`, `docs/…`) from current `main`, merged by pull request. Use a separate
  git worktree per agent so parallel agents never share a checkout. Keep `main` runnable (`cd app && npm run dev`).
- Before editing: `git fetch` and check `git status`. Never discard work you did not write. Never force-push `main`.
- No credentials or `.env` files in commits. Keys are read from env vars documented in `app/.env.example`.
- Real data only where the app claims it: Carta benchmarks in `bruin/assets/carta_benchmarks.csv` carry source URLs.
  Made-up data is allowed in tests only and never in `bruin/data/sessions/`.
- Agents decide for themselves: the orchestrator (`app/server/engine.ts`) only gives the floor by each agent's own urgency. Don't script agent lines.
- Before pushing: `cd app && npm run typecheck && npm test && npm run build`. For UI changes, check the page in a browser.
