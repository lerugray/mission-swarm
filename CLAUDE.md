# mission-swarm — Claude Code pointer

When you open a session in this repo, start here:

1. **Read `README.md` first.** Scope, architecture, explicit v1
   non-goals. The README is the single source of truth on what this
   tool is and isn't.

2. **Stack conventions.** TypeScript strict mode, Bun runtime.
   Verify via `bun test && bun x tsc --noEmit`. All simulation
   outputs go to `simulations/<run-id>/` (gitignored). Audience
   profile templates go under `audiences/` (tracked). No external
   database dependencies; persist state as JSON files.

3. **Streaming is load-bearing.** Reactions arrive round-by-round
   as `ReactionEvent` JSON via the `runSimulation` async generator
   in `src/rounds.ts`. Do NOT batch-and-dump — the value-prop is
   real-time consumability by parent simulations.

4. **Persona quality matters.** The persona-generation prompt in
   `src/personas.ts` and the per-audience `persona_template_guidance`
   in each `audiences/*.json` are voice-bearing. The shipped prompts
   were tuned for plausibility across distinct voice registers; tune
   carefully if at all.

5. **Provider abstraction.** OpenRouter is the default cloud
   provider; Ollama is the local-only path; Claude CLI is an
   optional pass-through. New providers go behind the `ChatOptions`
   interface in `src/providers/types.ts`. Don't bake a specific
   provider into upstream code.

6. **Out of scope.** See README.md "What it is not" — do not
   graduate features from the out-of-scope list (knowledge graphs,
   multi-platform simulation, prediction-market layer, full agent
   loops) without explicit user approval. Default is to stay small.

7. **Audience profiles are taste work.** New audience profiles or
   substantive edits to existing ones (especially
   `persona_template_guidance` text) require careful voice-bearing
   work. Sample templates in `audiences/` are reference quality;
   forks will write their own for their specific communities.
