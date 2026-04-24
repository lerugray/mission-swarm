# mission-swarm-aesthetic

Visual direction for MissionSwarm's viewer, control, and report surfaces.
This skill is loaded whenever a Claude session opens MissionSwarm to build
or modify UI. **Read fully before writing any component.**

MissionSwarm is a swarm-simulation engine: feed it a document, it generates
personas and streams their reactions round by round. It is operator infra,
not a consumer product. The UI serves wargame designers, policy analysts,
kriegspiel facilitators — people running scenarios at 2am who care about
information density and keyboard velocity, not about delight.

---

## The one-line brief

**Bloomberg-terminal / combat-information-center, not SaaS dashboard.**
Dense, dark, monospace-forward, amber-accented. Every pixel earns its keep.
No hero sections, no onboarding tours, no rounded illustrations, no empty
state that says "Let's get started!"

---

## Non-negotiable principles

1. **Density over polish.** Padding in 4–8px increments, not 16–32px. If a
   panel looks airy, it's wrong. Fit more information per screen.
2. **Keyboard-first.** Every action has a shortcut. Document the shortcut
   in the UI near the action (e.g. `▶ START [⏎]`). Power users live in the
   keyboard; the mouse is a fallback.
3. **No loading spinners.** If something takes >500ms, show partial results
   streaming in. MissionSwarm's architecture is streaming-native — the UI
   must reflect that. Placeholder rows with dim state beat blank screens
   with spinners.
4. **Color as signal, never decoration.** One accent (amber), plus a small
   set of semantic colors for drift / agreement / provider-state / error.
   Nothing is colored just because it looks nice.
5. **Monospace for anything computed.** Round numbers, timestamps, persona
   IDs, deltas, token counts, file sizes, costs. Sans only for
   natural-language reaction text and narrative prose.
6. **Dark mode is load-bearing.** Design in dark first. Light mode is a
   secondary accommodation, not equal-footing.
7. **Disagreement is spatial.** When two personas diverge, the layout must
   show it — not as a text alert, as geometry. Opposition columns, drift
   bridges, matrix cells with divergent fills.

---

## Anti-patterns — do not do these

- Hero images. Marketing copy. "Get started" CTAs the size of a persona row.
- Gradient backgrounds (except the subtle warm near-black base tone).
- Rounded corners above 2px. Terminal chrome is hard-edged.
- Drop shadows for depth. Use 1px borders and background tone stepping.
- Emoji. Status glyphs are `●`, `◆`, `╋`, `▲`, `▼`, `─`, not 😀.
- Progressive disclosure for primary info. Operators need it all at once.
- Consumer-y micro-animations (bounces, spring physics, confetti). The
  only allowed motion: cursor blink, new-row fade (0.5s), live-dot pulse.
- Per-persona avatars or generated faces. Persona ID + handle + role is
  the identity.
- Big empty states with illustrations. Use terminal-style placeholder
  blocks: `░ NO REACTIONS YET ░ press SPACE to stream`.

---

## Color tokens

All colors are defined as CSS custom properties. **Never hardcode hex
values in components.** If you need a color that isn't in this table, you
probably don't need it — ask the user first.

### Base neutrals (warm near-black, terminal CRT feel — not flat black)

| Token         | Hex        | Usage                                  |
|---------------|------------|----------------------------------------|
| `--bg-0`      | `#0a0907`  | App background, deepest surface        |
| `--bg-1`      | `#100e0b`  | Panel surface                          |
| `--bg-2`      | `#171410`  | Raised surface, panel headers          |
| `--bg-3`      | `#1f1b16`  | Hover state                            |
| `--bg-4`      | `#2a251e`  | Border emphasis                        |
| `--line`      | `#2a251e`  | Primary panel borders                  |
| `--line-soft` | `#1a1612`  | Intra-panel dividers, table row lines  |

### Foreground tones

| Token    | Hex        | Usage                                        |
|----------|------------|----------------------------------------------|
| `--fg-0` | `#f4ede0`  | Primary text, reaction content               |
| `--fg-1` | `#c9bfae`  | Secondary text, row metadata                 |
| `--fg-2` | `#8b8374`  | Tertiary, labels, panel header copy          |
| `--fg-3` | `#5c564b`  | Muted, dividers-as-text, disabled-ish        |
| `--fg-4` | `#3a362f`  | True-disabled, dot grids                     |

### Amber accent (terminal-classic)

| Token          | Hex                                | Usage                                         |
|----------------|------------------------------------|-----------------------------------------------|
| `--amber`      | `#ffa630`                          | Active tab, current round, primary emphasis   |
| `--amber-dim`  | `#c67d1e`                          | Amber on amber backgrounds                    |
| `--amber-bg`   | `rgba(255,166,48,0.08)`            | Active-cell fill, primary-button background   |
| `--amber-bg-2` | `rgba(255,166,48,0.14)`            | Primary-button hover                          |
| `--amber-line` | `rgba(255,166,48,0.28)`            | Active borders                                |

Other accent palettes are available (cyan/CIC, green/phosphor, magenta) as
tweakable alternatives, but **amber is the default and the one the SKILL
prescribes**. Swap only when the user explicitly asks.

### Signal colors (meaning, not decoration)

| Token               | Hex        | Meaning                                        |
|---------------------|------------|------------------------------------------------|
| `--sig-agree`       | `#7dcf8a`  | Positive drift, endorsing stance, +delta       |
| `--sig-agree-bg`    | 10% alpha  | Fill behind agreeing reactions                 |
| `--sig-oppose`      | `#e86a5a`  | Negative drift, opposing stance, −delta        |
| `--sig-oppose-bg`   | 10% alpha  | Fill behind opposing reactions                 |
| `--sig-neutral`     | `#8b8374`  | Neutral stance, ±0 delta                       |
| `--sig-drift`       | `#d9a94a`  | Notable drift-this-round marker                |
| `--sig-provider`    | `#6fb5d1`  | Provider name, model ID, system state          |

---

## Typography

```
--mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
--sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

**Mono usage:** everything computed. Persona IDs (P01, P14), timestamps,
round numbers, deltas (+12, −6), costs ($0.47), token counts, tag names
(#moat, #compliance), model IDs, file names, kbd shortcuts, table cell
values, panel header labels, chip content.

**Sans usage:** reaction body text, narrative report prose, document
excerpts, long-form persona roles.

### Type scale (tight)

| Token     | Size | Usage                                         |
|-----------|------|-----------------------------------------------|
| `--fs-xs` | 10px | Panel header labels, chip text, metadata      |
| `--fs-s`  | 11px | Tertiary body, table cells                    |
| `--fs-m`  | 12px | Default body, form inputs                     |
| `--fs-l`  | 13px | Reaction text, emphasized values              |
| `--fs-xl` | 15px | Persona names in detail headers               |
| `--fs-xxl`| 18px | Report narrative lede, hero metrics           |

Never use larger than 18px. There is no 32px text in MissionSwarm.

### Type conventions

- **ALL CAPS + 0.06–0.08em letter-spacing** for labels, panel headers, tabs.
  This is terminal-system-label voice, not shouting.
- Mono text: enable `font-feature-settings: 'zero', 'ss01'` for
  unambiguous 0 vs O.
- Sans body: `text-wrap: pretty` on any multi-line natural-language block.
- Line-height 1.4 for dense lists, 1.5 for reaction bodies, never above 1.6.

---

## Spacing

```
--sp-1: 2px;  --sp-2: 4px;  --sp-3: 6px;  --sp-4: 8px;
--sp-5: 12px; --sp-6: 16px; --sp-7: 20px; --sp-8: 24px;
```

**Panel padding:** `--sp-5` to `--sp-6` default. `--sp-7` only in config
forms or report narrative. **Never above --sp-8.**

**Row padding:** `--sp-3` to `--sp-4` vertical, `--sp-5` horizontal. Rows
should be 24–32px tall in default density.

**Gap between chips:** `--sp-2` inside a group, `--sp-3` between groups.

---

## Component vocabulary

Reach for these names; don't invent new ones without good reason.

### App shell
- **top bar** — 28px tall. Brand · tab nav · run-status on the right.
  Tabs show shortcut hints in `<span class="hk">`.
- **status bar** — 22px tall. Cells separated by 1px lines. Cells contain
  `statusbar-label` + value. Always show: SIM name, round counter, reaction
  counter, provider, tokens, cost/budget, elapsed, status (LIVE / PAUSED /
  COMPLETE / IDLE). Right-most cell has accent color and blink on LIVE.

### Panel
- **panel** — bordered container. 1px `--line` border, `--bg-1` surface.
- **panel-header** — 26px tall, `--bg-2` background, all-caps mono label.
  Optional trailing count in amber (e.g. `PERSONAS 14`). Right-aligned
  slot for filter controls.
- **panel-body** — scrollable content area. Overflow is always explicit.

### Row kinds
- **persona-row** — ID (mono, `--fg-2`) · handle (mono, `--fg-0`) · role
  (sans, `--fg-3`, ellipsis) · stance-bar · delta-chip · reaction count.
  Hover: `--bg-2`. Recently-active (rxn in last 3): `--amber-bg` background.
- **reaction-row** — grid: persona-block (110px) · text (fluid) · delta
  column (auto). Text uses `text-wrap: pretty`. Tags on a second line.
- **round-header** — sticky row, 1px amber top border. `ROUND 04 │ T+12:00
  │ Maintainer AMA; 0.2 roadmap disclosed` · trailing count.

### Primitives
- **chip** — 1px border, tight padding (1px 6px), mono-xs text. Variants:
  `amber`, `agree`, `oppose`, `neutral`, `drift`, `provider`. Use for
  status, tag, delta, category.
- **kbd** — shortcut key indicator. 1px border + 2px bottom, mono-9,
  uppercase. Lives next to the action it triggers.
- **sparkline** — 50–80px wide, 14–20px tall. Polyline with dots at each
  round. Dashed zero-line. Color matches drift direction
  (`--sig-agree` / `--sig-oppose`) or `--amber` for neutral display.
- **stance-bar** — 40–70px horizontal rail. Center tick at zero, colored
  dot at stance position, glow-shadow on the dot.
- **delta-chip** — `+N` in `--sig-agree`, `−N` in `--sig-oppose`, `±0` in
  `--sig-neutral`. Always the same shape.
- **live-dot** — 6px pulsing amber dot. Use ONCE per screen, near the
  thing that is live.

### Forms
- **field** — label above input. Label is mono-xs, uppercase, `--fg-2`.
  Optional hint right-aligned in `--fg-3`.
- **input / select / textarea** — `--bg-0` fill, 1px `--line` border,
  mono body. Focus: `--amber-line` border + inset shadow.
- **seg** — segmented control. Use for 2–4 exclusive options, especially
  in toolbars. Active segment: `--amber` text on `--amber-bg` fill.
- **btn** — uppercase mono label. Variants: default, `primary` (amber),
  `ghost` (transparent), `danger` (`--sig-oppose`). Shortcut `<kbd>`
  often appears inside the button.

### Signals
- **drift marker** — when a reaction changes stance by >6, label the
  reaction with `◆ DRIFT` in `--sig-drift`.
- **opposition pair** — when two personas hold opposing stances on the
  same round, display them in a 1fr · 40px · 1fr grid with `VS.` in the
  center slot, both panels tinted with `--sig-agree-bg` / `--sig-oppose-bg`.

---

## Layout grids

### The four surfaces

All four surfaces share the same 3-row shell: top bar (28px) · content
(fluid) · status bar (22px). Never break this. Never add a second nav.

1. **Config** — 1.1fr + 1fr split. Left: input document + extracted
   entities. Right: simulation params · provider · start button.
2. **Stream** — see below, three variants, user picks.
3. **Persona detail** — 240px + fluid. Left: persona list with stance
   bars. Right: header with sparkline trajectory + reaction timeline.
4. **Report** — 1.2fr + 1fr. Left: narrative + metrics + shift ranking +
   key disagreements. Right: exports list + final stance table.

### Stream view — three supported variants

MissionSwarm's key screen. All three express layout tension for
disagreement; pick based on the operator's analysis mode.

- **A · Ledger** — default. 30-40% persona list, rest is round-by-round
  reaction feed. Best when the operator is reading discourse as it
  unfolds. New reactions fade in at bottom.
- **B · Opposition** — two-column split. Endorsing reactions on the
  left, opposing on the right, round marker down the center spine. Best
  when the operator wants to see the shape of disagreement, not the
  content. Tally strip at top.
- **C · Matrix** — persona-rows × round-columns grid. Cells are tinted
  by stance. Reaction text lives inside the cell (line-clamped to 4
  lines); click to expand in a bottom drawer. Best when the operator
  wants to scan drift patterns across the full run.

When adding a new stream variant, require the same contracts:
- Show round counter prominently, visible at all times.
- Mark the current round visually (amber fill/border).
- Support the same interaction: click persona anywhere → detail view.
- Work under all three density settings.

---

## Density settings

Three levels, controlled by class on the app root:

- **comfortable** — slightly larger padding. Use for demos and walkthroughs.
- **dense** (default) — what the SKILL prescribes.
- **extreme** — shrinks mono fontsize to 11/10/9, compresses padding.
  Use when the operator is on a single 1080p display driving 14+ personas.

Never hard-code padding — use the spacing tokens so density swaps work.

---

## Keyboard shortcut standards

| Key       | Action                                         |
|-----------|------------------------------------------------|
| `1`–`4`   | Switch view (Config / Stream / Personas / Report) |
| `SPACE`   | Play / pause stream                            |
| `→`       | Step one round                                 |
| `R`       | Reset to round 0                               |
| `End`     | Seek to end of run                             |
| `⌘N`      | New simulation (from config)                   |
| `⌘S`      | Save config                                    |
| `⏎`       | Start simulation (from config submit)          |

Any new action: add a shortcut. If you can't find an unused key, you're
adding too many actions.

---

## Voice & copy

- **Labels:** terse, all-caps, abbreviated when an operator would
  recognize the abbreviation. `RXN` not `REACTION COUNT`. `PROV` not
  `LANGUAGE MODEL PROVIDER`.
- **Empty states:** terminal-style placeholder. `░ NO REACTIONS YET ░`.
  Include the fix: `press ▶ or → to advance`.
- **Errors:** plain and specific. `provider unreachable: openrouter (504)`.
  Never `Oops!`, never `Something went wrong`.
- **Report narrative:** sans, human-readable sentences. This is the one
  place MissionSwarm speaks in prose. Even here, no marketing tone —
  treat it as a staff report.

---

## Animation rules

- **Row-in** — 0.5s fade + 4px translate-y on new streamed reactions,
  amber background flash that decays. Only for the streaming feed.
- **Live-dot pulse** — 1.4s ease-in-out on the single live indicator.
- **Blink** — 1s step, 50/50 duty, for the `▊` cursor in streaming mode.
- **No easing** on hover, state changes: 0.06s linear or instant.
- **Nothing else.** No slide-ins, no expand-collapses with springs, no
  ambient particles.

---

## Violations checklist (for review)

Before shipping a new surface, check:

- [ ] Does any padding value exceed `--sp-8` (24px)?
- [ ] Any animation longer than 0.5s?
- [ ] Any rounded corner above 2px?
- [ ] Any full-width heading larger than 18px?
- [ ] Mono used for any free-text (reaction body, report prose)?
- [ ] Sans used for any computed value (delta, round, ID, timestamp)?
- [ ] Action without a keyboard shortcut?
- [ ] Loading spinner anywhere?
- [ ] Color used decoratively — not as a signal?
- [ ] Hero section, hero image, or marketing CTA?
- [ ] Status bar missing round/provider/cost/status cells?

Any "yes" is a violation. Fix before merging.

---

## Reference artifact

A working prototype lives at `MissionSwarm Viewer.html` (project root).
It exercises all four surfaces, all three stream variants, the density
settings, the signal palette, and the keyboard shortcuts. When in doubt,
match it.

Scenario data in that prototype is the GeneralStaff 0.1 launch —
open-source / BYOK / local-first agent orchestrator. 14 personas across
6 rounds. Use it as the canonical example of reaction voice, drift
cadence, and disagreement shape.
