# Agent entry point

Several agents (Claude Code cloud sessions, local sessions, teammates' agents) write to
this repo at the same time during the hackathon. Read this file, then `docs/PLAN.md`,
then your brief in `docs/briefs/` before changing anything.

## Working together

- Run `git fetch origin && git status` before editing. Never discard or overwrite files
  you did not create; another agent may own them.
- One agent = one brief = one branch. Branch from current `origin/main` as
  `agent/<brief-name>` (e.g. `agent/frontend-map`). Do not commit directly to `main`.
- Stay inside the files your brief lists as yours. If you must touch a shared file
  (package manifests, shared types, routing), keep the change minimal and say so in the PR.
- Open a PR into `main` when your brief's "done when" checks pass. Small PRs, merged often.
  Rebase on `origin/main` before opening; never force-push `main` or someone else's branch.
- Keep credentials and `.env*` files out of commits. Read keys from environment variables
  and document the variable name in `.env.example`.

## Quality bar

- Real data where the demo claims real data. Mock data is fine in tests and must be
  labelled as mock in the UI if it ever appears there.
- Run the build and tests before opening a PR. For UI changes, check the page in a browser
  (Playwright is available in cloud sessions) and attach a screenshot to the PR.
- Update `docs/PLAN.md` status when you finish a brief, and write a short handoff note in
  your brief: what works, what is stubbed, how to run it.
