# Fable direction memo — mission-swarm (2026-06-12, final-night blitz)

State read: the engine is built and at rest. All 11 GS tasks done, backlog zero, repo clean.
v1 shipped April 26 (types, providers, personas, streamed round loop, CLI, tests, 3 audience
profiles, LLM audience generator). June 10 added AGPL-3.0, talk-to-persona, and council mode
(parallel independent voices + synthesis, the Mission-Companion MC pattern), plus the HAi
launch-copy smoke-tester. Repo is PUBLIC (`lerugray/mission-swarm`, verified via gh). The
`docs/markov-analysis-design.md` layer is design-only by its own header, unimplemented. A
100-line MISSION.md exists on the GS-private side at `state/mission-swarm/MISSION.md`
(junctioned in via the `state/` symlink) — the scout brief claimed none existed; it was wrong.

## The calls

1. **LOCK — council mode lives here, as a library capability.** `src/council.ts` sits beside
   `talk.ts` and `simulation.ts`, sharing providers and personas. mission-companion calls
   swarm; it never re-implements the engine. If companion needs council, the work item is
   "export a clean library API from swarm," not "port council into companion." Duplicating
   the engine creates two divergent MC patterns and doubles every provider fix.

2. **LOCK — Markov analysis stays a design artifact. No task gets logged.** The doc says it
   plainly: "not a build plan." Build it only when a real consumer wants transition analysis
   of an actual simulation's output (empirical pull, not speculative push). Logging a pending
   task now would manufacture fake liveness on a deliberately zero backlog.

3. **LOCK — refresh the existing GS-side MISSION.md; do NOT add a repo-root one.** The repo
   is public and README is the public product statement. The GS MISSION carries orchestration
   framing that shouldn't ship publicly, and it is status-stale (it still claims the engine
   isn't built and frames fail-closed bot posture from registration day). Scrape the status
   per the purpose-not-status rule; keep the scope-boundary purpose prose.

4. **LOCK — stays interactive-only.** With zero pending tasks there is nothing to flip
   bot-pickable; revisit only if a real backlog forms. Don't pre-engineer bot eligibility
   for an empty queue.

5. **LOCK — posture is complete-at-rest, not abandoned.** This is a library-tier
   ecosystem tool (F:0, ecosystem-bearing). Zero backlog is the correct resting state. New
   work enters only when pulled by a consumer: companion's council, HAi copy smoke tests,
   or the kriegspiel direction.

6. **[RAY] my lean:** the next real pull on swarm is the kriegspiel reaction engine for the
   wargame projects — its original purpose. Whether and when that direction fires is a
   purpose call, Ray's axis. The engine is ready for it whenever he is.

## Risks to respect

- **A successor reads zero backlog as dead and archives it.** Don't. It is at-rest library
  capacity that two live consumers (companion, HAi) already touch.
- **Companion re-implements the MC pattern locally** instead of calling swarm — call 1 in
  reverse. Watch for it in any companion council work.
- **Council and talk shipped 06-10; I have not verified they were exercised end-to-end.**
  Per features-ship-on-behavior, the first session that builds on either should smoke-run
  it against a real doc first.
- **Stale GS MISSION.md** will mislead session-start reads until call 3 lands (the FnordOS
  failure shape).
- **Public repo + private state junction.** `state/` is gitignored (e8ce5ec); keep it that
  way — the junction targets GS state that must never land in a public tree.

## Fable-era note

Preserve the lean-rebuild register: this project IS the "~20% of MiroShark worth keeping,"
rebuilt small on TS/Bun, and every addition has honored that — talk and council are thin
modes over the same engine, not subsystems. The README voice is stop-slopped and
em-dash-free for the public ship; keep it that way. Positioning convention: swarm is an
instrument other projects pick up, not a product chasing its own users — consumer-pulled,
library-first, AGPL. The design-doc-before-task discipline (markov doc, ms-010) is the
house style here; a successor adding a layer should write the thinking first so the task
can be narrow.
