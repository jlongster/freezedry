# Common instructions for hybrid-track agents

You are building the **hybrid** architecture for the Prepack revival: run initialization in the real engine (V8/Node 26), capture the heap, and emit JS that rebuilds it. Read `hybrid/DESIGN.md` first; its capture graph format is the contract between tracks.

Background for context only: `docs/revive/RESEARCH.md`, `docs/revive/PLAN.md`, `bench/TRIAGE.md`, and the Prepack benchmark results in `bench/results/`.

## Workspace
- You have your own git worktree on your own branch, created from branch `hybrid`. Path and branch are in your task.
- All code goes under `hybrid/`. **Do not modify Prepack's `src/`, `scripts/` or `test/`** (other agents are changing them concurrently). You may read and import them.
- `hybrid/` has its own `package.json`. Prefer zero dependencies: Node built-ins `vm`, `inspector`, `v8`, `util`. A parser such as acorn is fine if needed: install it inside `hybrid/` only. Never touch the root `node_modules` symlink.
- Never touch `/tmp/opencode/pp-work` (the main checkout) or other agents' worktrees in `/tmp/opencode/pp-wt/*`. Read-only use of `/tmp/opencode/pp-wt/bench` is fine.
- Plain modern JS (CommonJS, Node 26). Style: small modules, no Flow needed, prettier-formatted. Tests via `node --test hybrid/test/`.

## Rules
- **Correctness beats coverage.** Never emit approximate state; bail out with a reason instead (see DESIGN.md "Hard rules").
- Every feature gets tests. Each test is a small input script with assertions on the rebuilt state, checked in fresh vm contexts: original vs output.
- Keep the capture-graph format stable. If you must extend it, extend it compatibly and document the change in DESIGN.md in the same commit.
- Commit early and often on your branch with conventional commits: `feat(hybrid): ...`, `test(hybrid): ...`. Don't merge into `hybrid` or push; the coordinator merges.
- Write a short note at `hybrid/docs/<your-track>.md`: what works, what bails and why, and next steps.

## Report back (final message)
- What works, with test counts, and what bails and why.
- Commits and files.
- Numbers where relevant: libraries from `bench/libs/dist/*.js` that capture, emit and verify; sizes; timings.
- Interfaces other tracks depend on, and open questions.
