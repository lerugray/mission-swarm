# MissionSwarm — Claude Design Brief

For upload to **claude.ai/design**. Purpose: generate a
`SKILL.md` that defines the visual direction when MissionSwarm
grows a UI layer — streamed persona-reaction viewer, simulation
runner, and report generator. The tool is CLI-first today (v0.0.0
scaffold) but a viewer surface will be needed once simulations
produce enough content to watch unfold live.

---

## What this is

**MissionSwarm** is a lightweight swarm-simulation engine.
Feed it a document (press release, event summary, campaign
brief, news article) — it generates personas and streams their
reactions, disagreements, and opinion drift round by round in
real time.

TypeScript + Bun. OpenRouter or Ollama for LLM calls. JSON per
simulation. No DB, no graph engine, no GPU requirement. The
~20% of MiroShark that's actually useful for Ray's kriegspiel
direction, rebuilt lean.

The intended use case is **wargame / strategic-scenario
simulation**: when a broader kriegspiel project needs *"how does
the domestic / foreign / media audience react to this event?"*,
MissionSwarm streams the answer in a form the outer simulation
can consume.

This brief focuses on the eventual viewer / control surface.
CLI scaffolding is already in place; the SKILL.md should guide
the *visual layer* when it's built.

---

## Core product constraint

**MissionSwarm is not a consumer product.** It's a tool used by
operators running scenarios — wargame designers, policy analysts,
researchers, kriegspiel facilitators. The UI serves that use
case: **information density over visual polish**, operator speed
over beginner accessibility.

This is a Bloomberg-terminal / combat-information-center
aesthetic, not a consumer-social aesthetic.

---

## Visual anchors

Pick one or more of these from the awesome-claude-design
starter pool (or propose alternatives with equivalent vibe):

- **Raycast** — clean terminal-adjacent productivity. Neutral
  dark surface, tight information hierarchy, typographic
  restraint.
- **Linear** — clean B2B dashboard. Dense but legible. Generous
  use of grayscale + one accent.
- **Warp** — modern terminal. Hard-edged panels, blinking
  cursor cadence, readable-at-speed typography.
- **The Verge** (dark mode) — journalism-dense information
  hierarchy, good for the "streaming reactions" feed layout.

**Not** in scope: Stripe's consumer elegance, Notion's
approachability, anything playful, anything with hero
marketing-site energy. This is a workbench, not a landing page.

---

## Functional surface

The UI needs to show:

### 1. Simulation configuration panel (one-time per run)
- Input document upload + quick preview
- Persona generation controls (count, sampling strategy, domain
  constraints)
- Round count + pacing
- LLM provider selection (OpenRouter / Ollama / dry-run)

### 2. Live reaction stream (the main view)
- Each persona is a row or card.
- Their reactions update **round by round** as the simulation
  advances.
- Opinion drift is visible — a persona's stance shifting from
  round 3 to round 4 must read instantly.
- Disagreements between personas surface visually — not as text
  alerts, as layout tension (two personas converging vs.
  diverging should be spatially legible).
- Timestamp / round marker always visible.

### 3. Persona detail view (click-through)
- Full history of one persona across all rounds
- Their reactions in sequence
- Their opinion trajectory (simple line graph, no 3D, no
  animations)
- Source excerpts they've reacted to

### 4. Simulation report (end-of-run)
- Exported JSON summary (already handled in the engine — UI just
  links to the output file)
- Optional human-readable summary view (can be PDF-exportable)

---

## Operator-speed principles

- **Keyboard-first.** Every action has a shortcut. Power users
  live in the keyboard.
- **No loading spinners.** If an operation takes >500ms, it
  should show progress state with partial results visible.
  MissionSwarm's streaming architecture supports this — the UI
  should reflect it.
- **Dense information, no wasted whitespace.** Padding in
  4-8px increments, not 16-32px. Fits dense screens.
- **Monospace for anything computed** (round numbers, timestamps,
  persona IDs). Sans for natural-language reactions.
- **Color as signal, not decoration.** One or two accents max.
  Neutral dark base. Color = opinion-drift direction, agreement
  intensity, provider state — never just "hey look at this."

---

## Streaming-reactions-feed layout (the key screen)

The reaction-stream view is the heart of the UI. Think:

- **Left column (30-40% width):** persona list with rollup
  stats. Each row shows ID, current opinion (compressed to a
  single token or small icon), last round's delta.
- **Right column (rest):** the live reaction feed — each
  round's round-header with timestamp, followed by the reactions
  that came in this round. New reactions slide in at the bottom.
  No animation beyond a subtle fade.
- **Top bar:** round counter, pacing controls (pause / step /
  resume), simulation-name.
- **Bottom bar:** status (provider, cost tally, time elapsed,
  round N of M).

At any moment, the operator should know: what round is it, who
disagrees with whom, which personas are drifting, what the next
input event will be (if pre-scheduled), and how much budget the
run has consumed.

---

## What the SKILL.md should produce

When a future Claude session opens MissionSwarm to build UI,
the SKILL should let me:

1. Reach for the right component vocabulary without
   re-deriving it from scratch (card, row, round-header, chip,
   inline-chart).
2. Call the right typographic choices (monospace / sans /
   weights / sizes) without guessing.
3. Apply the right color token for each signal type (agreement,
   drift, provider state, error, neutral).
4. Pattern-match operator-speed violations (hero images,
   oversized CTAs, consumer-y micro-animations, progressive
   disclosure patterns that hide dense info).
5. Stay consistent across the config / stream / detail / report
   views — same layout grid, same component set.

---

## Constraints

- **Not a consumer product.** Do not optimize for first-time
  user delight.
- **Not a dashboard product.** This isn't Datadog-scale analytics
  — it's a single-simulation viewer. Don't over-rotate on
  enterprise-dashboard patterns.
- **Dark-mode primary.** Light mode is a secondary consideration,
  not equal-footing. Operators run this at 2am during scenario
  work; dark mode is load-bearing.
- **Technology neutral.** Don't prescribe React vs Svelte vs
  vanilla. The SKILL is about visual + interaction patterns,
  implementation is a separate decision.

---

## Reference anchors

- Bloomberg Terminal (2000s-era screenshots, not modern)
- USAF Combined Air Operations Center displays (publicly-released
  imagery, for the information-density vibe)
- Financial trading desks circa 2015 — multiple monitors, dense
  panels, no pretty
- NATO wargame recordings / kriegspiel archive photos (for the
  professional-tool aesthetic)
- [aaronjmars/MiroShark](https://github.com/aaronjmars/MiroShark)
  — the research-grade parent MissionSwarm is the trimmed
  descendant of. MissionSwarm's UI should feel like a lighter /
  faster / operator-focused cousin, not a rewrite of MiroShark's
  research-report UX.

---

## Output target

`SKILL.md` extracted from claude.ai/design output zip, dropped at
`mission-swarm/.claude/skills/mission-swarm-aesthetic.md`. All
subsequent UI-building sessions route through it.
