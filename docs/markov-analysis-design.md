# Markov-chain analysis — design notes

Status: design-only. No implementation yet. Draft 2026-04-24.

MissionSwarm produces round-by-round streams of stance/interest
deltas per persona per topic. That's time-series data with a
structural property worth exploiting: **the state space is discrete
(stance + interest vectors), and transitions are driven by a
combination of persona identity, topic, and recent-feed context.**
That's a natural fit for Markov-chain analysis as a post-simulation
(or mid-simulation) report layer.

This doc scopes what "Markov analysis" would mean for MissionSwarm,
what questions it would answer, and what the shape of an implementation
would look like. It is not a build plan — it's the thinking that
should precede one so the resulting task can be narrow.

## What we have to analyze

Every completed simulation produces `state.json` with:

- N personas, each with a `stance: Record<topic, −1..+1>` and
  `interest: Record<topic, 0..1>` that mutated over R rounds.
- R rounds, each containing K reactions. Each reaction has
  `text` (free-form), `stance_delta`, and `interest_delta` per
  topic.
- For any persona p and any round r, we can reconstruct the full
  (stance, interest) vector by replaying deltas from round 1 to r.

So the raw substrate is a trajectory per persona through a
continuous-ish topic-state space. "Continuous-ish" because stance
values are real numbers but personas tend to cluster (most deltas
are small, and ±1 are hard caps).

## What Markov framing adds

A Markov chain treats the state space as discrete buckets and
models transitions as a matrix P(next_state | current_state). For
MissionSwarm the interesting framings:

### 1. Per-persona-type × per-topic transition matrix

Bucket stance into a small number of bands (e.g. `−`, `0`, `+` —
or 5 bands for finer grain: strong-opp, opp, neutral, support,
strong-support). For each persona template group (nationalist,
foreign-allied, military-hawk, etc.), aggregate across runs and
compute the observed transition probabilities:

    P(stance_band_{r+1} | stance_band_r, template_group, topic)

Across enough runs, this matrix surfaces patterns like:
- "Conservative hawks rarely flip stance on escalation_risk —
  the diagonal is heavy" → high stance stability
- "Swing-state moderates oscillate on economic_fallout across
  rounds" → high off-diagonal mass, weak mixing
- "Foreign adversary voices tend to strengthen over rounds" →
  absorbing state near −1 or +1

Useful for: operator-facing summaries ("this audience type is
more reactive than that one"), simulation calibration (if a
group shows implausibly stable or implausibly reactive behavior,
the prompt or persona templates need tuning).

### 2. Topic cascade graph

Within a single simulation, build a DAG of topic co-movement:
if topic X's stance shifts in round N and topic Y's stance shifts
in round N+1 with above-chance correlation (across personas), X
likely caused Y. Over enough simulations, the aggregated cascade
edges form a weighted graph — "narrative_control → institutional
_credibility" at weight 0.64 means: 64% of simulations where a
narrative-control stance shift happened, an institutional-credibility
shift followed within 2 rounds.

Useful for: wargame designers who want to know, "if I seed this
event, what downstream topic reactions will emerge?" The graph
answers that empirically rather than theoretically.

### 3. Opinion-cluster evolution (faction formation / dissolution)

Treat each persona at round r as a point in stance-space. Cluster
(via k-means, DBSCAN, or hierarchical clustering — the choice is
secondary). Track how clusters split, merge, or realign across
rounds. The Markov framing lives at the cluster level: how do
inter-cluster transitions behave? Are there clusters that absorb
others, or clusters that fragment reliably?

Useful for: detecting emergent coalition dynamics that weren't
designed-in. If the nationalist and progressive clusters converge
on the same position in round 4 of every run, something in the
prompt/event is structurally collapsing them — often the most
interesting finding from a simulation.

## What this is NOT

Important to bound the scope so future implementation doesn't
drift:

- **Not real-time prediction.** A round-N persona doesn't consult
  its template's transition matrix to decide how to move. Markov
  analysis is OBSERVATIONAL — run the simulations, then analyze.
  Making the LLM consult a learned matrix would break the current
  "persona reacts from bio + feed" model.
- **Not a reasoning agent.** The full MiroShark "summary + ReACT
  agent" path is explicitly out of scope (see ms-009). Markov
  analysis is statistical-descriptive, not interpretive. If an
  analyst wants the "so what" narrative, they read the summary +
  the transition matrix side-by-side; the tool doesn't narrate.
- **Not a replacement for watching the feed.** A transition matrix
  collapses a rich reaction text stream into band-level transitions.
  For operator intuition about WHAT arguments moved WHO, the text
  matters more. Markov is one layer of the report, not the whole
  report.

## Data shape sketch

A report generated from analysis would be JSON + Markdown siblings,
colocated with the simulation state:

    simulations/<id>/
      state.json        ← produced by ms-004
      summary.md        ← produced by ms-009 (future)
      markov.json       ← produced by this analysis layer
      markov.md         ← human-readable companion

Shape of `markov.json` (sketch — not binding):

```json
{
  "stance_bands": ["strong_opp", "opp", "neutral", "support", "strong_support"],
  "per_topic_transitions": {
    "escalation_risk": {
      "template_group_transitions": {
        "military_hawk": {
          "strong_opp": { "strong_opp": 0.0, "opp": 0.0, ... },
          "opp": { ... },
          ...
        },
        "nationalist": { ... }
      },
      "aggregate_transitions": { ... },
      "band_durations": {
        "military_hawk": { "mean_rounds_in_support": 4.2, ... }
      }
    }
  },
  "topic_cascade_edges": [
    { "from": "narrative_control", "to": "institutional_credibility", "lag": 1, "weight": 0.64, "n_simulations": 12 }
  ],
  "cluster_evolution": {
    "per_round": [
      { "round": 1, "clusters": [ { "centroid": { "escalation_risk": -0.2, ... }, "members": ["p0", "p4"] }, ... ] },
      ...
    ],
    "flow_events": [
      { "round": 3, "kind": "merge", "clusters_in": ["c0", "c1"], "cluster_out": "c0" },
      { "round": 5, "kind": "split", "cluster_in": "c2", "clusters_out": ["c2a", "c2b"] }
    ]
  }
}
```

`markov.md` is the same content rendered as a human-scannable
report — small tables for transition matrices, a listing for
cascade edges, a per-round cluster summary. Designed to be read
in a text editor.

## Where cross-run aggregation lives

A single simulation's Markov matrix is noisy — 20 personas × 10
rounds = 200 transitions, spread across dozens of topics. Per-topic
the sample size per template group per band is tiny. Useful matrix
estimates come from aggregating ACROSS simulations that share an
audience profile.

Two flows:

1. **Per-simulation analysis** — runs once when a single sim
   finishes. Produces that sim's `markov.json`. Low sample size,
   used for cluster-evolution + intra-sim cascade graph (both of
   which ARE well-sampled within one run).
2. **Cross-simulation aggregation** — runs across a directory
   of simulations sharing an audience profile. Produces
   `audiences/<id>/markov-aggregate.json`. High sample size,
   used for the transition matrices + cascade-graph edge weights.

The aggregation job is itself non-trivial: version-skew (prompt
changed between runs invalidates comparisons), topic-name drift
(same meaning, different emergent label — requires a mapping /
clustering step before aggregation).

## Implementation pathway

A reasonable future task sequence would be:

1. `ms-ma-001` — Band the stance + interest into discrete buckets.
   Add `bandStance(value: number): Band` + `bandInterest(value:
   number): Band` in a new `src/analysis/bands.ts`. Tests: edge
   cases at bucket boundaries.
2. `ms-ma-002` — Build per-simulation transition matrix. Given a
   `SimulationState`, produce an object keyed on (template_group,
   topic) → bands → transition counts. Tests: deterministic on
   canned state.
3. `ms-ma-003` — Topic cascade extractor. Given per-round deltas,
   find (from_topic, to_topic, lag) pairs where a correlation
   threshold is crossed. Output is weighted edges per sim.
4. `ms-ma-004` — Cluster evolution. For each round, cluster
   personas in stance-space (k-means with auto-k selection or
   hierarchical). Track cluster membership + centroids across
   rounds, detect merge/split events.
5. `ms-ma-005` — Cross-sim aggregator. Given a directory of
   completed sims sharing audience_profile_id, aggregate
   transition matrices + cascade edges with sample-size
   weighting. Surface warnings for small n.
6. `ms-ma-006` — Report writer. Given any of the above outputs,
   render a human-scannable `markov.md`.

Each of ma-001 through ma-004 is bot-pickable once there's a test
harness — pure data transforms, deterministic inputs, unit-testable.
ma-005 + ma-006 are interactive (aggregation-correctness + report
voice both require Ray's eye).

## Alignment with GS integration

If mission-swarm ends up as a GS subsystem (separate design doc in
`private-generalstaff/docs/internal/`), Markov analysis is exactly
the kind of output GS would consume. GS could use it to:

- Flag simulations where a stance cascade crossed a threshold (for
  escalation-risk scenarios)
- Feed transition matrices into task generation ("the audience is
  moving on narrative_control — queue a tasks.json entry to draft
  a counter-messaging outline")
- Cross-reference across audience profiles ("is this event landing
  differently in kriegspiel vs gaming-community?")

The shape of the JSON output is deliberately machine-parseable so
GS can ingest without re-parsing prose.

## Open questions for Ray

These should be answered before ma-001 is actually queued. Not
urgent — the whole Markov layer is post-v1-engine work.

1. **Banding resolution.** 3 bands (neg/neutral/pos) or 5 bands
   (strong_neg / neg / neutral / pos / strong_pos)? 3 makes
   small-sample transition matrices readable; 5 captures more
   nuance but needs 25-cell matrices per topic.
2. **Clustering algorithm.** k-means is simple but needs k; DBSCAN
   doesn't but needs density params; hierarchical is
   intuition-friendly but cubic. Default probably k-means with
   elbow-method k selection.
3. **Cascade-edge correlation threshold.** Too low = noise; too
   high = no edges. Calibrate empirically on 3–5 pilot sims.
4. **Cross-sim topic-name normalization.** Build a manual mapping
   file per audience profile? Cluster topic names by LLM? Defer?
5. **Where does the analysis layer live in the codebase?**
   `src/analysis/` as a sibling to the simulation engine, with
   its own tests/ tree.

None of these are blockers for getting started — they're the
decisions to surface once implementation begins.
