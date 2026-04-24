// MissionSwarm — post-simulation summary (ms-009).
//
// Single-shot summarization pass over a completed simulation's full
// state. Produces a short analytical summary a wargame designer or
// scenario analyst can read in ~2 minutes to understand how the
// audience reacted to the input event.
//
// Intentionally NOT a ReACT-style reasoning agent — MiroShark's full
// report agent is out of scope for mission-swarm. This is one LLM
// call over the full persona + reaction feed, structured by prompt
// rather than by tool-use iteration.
//
// The prompt is voice-bearing — if the summary tone feels off on
// real runs, tune SUMMARY_SYSTEM_PROMPT here; it is the single source
// of truth for summary voice.

import type { LLMProvider, ChatMessage } from "./providers/types";
import type { Persona, Reaction, SimulationState } from "./types";

export interface SummaryOptions {
  /** Model override — passed to provider.chat as options.model. */
  model?: string;
  /** Temperature. Default: 0.4 — enough for prose flow, low enough to stay grounded. */
  temperature?: number;
}

// ─────────────────────────────────────────────────────────────
// System prompt — the voice-bearing piece
// ─────────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT = `\
You are analyzing a completed audience-reaction simulation. The simulation generated a set of personas (reacting voices), ran them through N rounds of reaction to an input event, and recorded every reaction + every stance-and-interest delta. Your job is to produce a short analytical summary a wargame designer, scenario analyst, or comms strategist can read in about two minutes to understand how the audience responded.

You are a summarizer, not a debater. Do not editorialize about whether the audience reacted well or badly. Describe what the audience did. Cite voices by name. Reference topics by the names the simulation used (e.g. "escalation_risk", "civilian_harm") rather than inventing new topic labels.

OUTPUT STRUCTURE (follow exactly, in this order, with these exact headers):

## Input
One paragraph restating the event or policy action being reacted to. Neutral framing — no value judgments.

## Reaction arc
One-to-two paragraphs tracking aggregate sentiment drift across rounds. Name the 3-5 topics with the biggest aggregate stance deltas (sum of deltas across all personas per topic). For each, say which direction the audience moved on net. Note whether rounds converged (stances tightened) or diverged (stances polarized).

## Active factions
Identify 2-4 emergent factions — clusters of personas who ended up taking similar positions. Name the clusters in your own words (e.g. "deterrence hawks", "sovereignty skeptics", "frontline existentialists") — don't rely on the audience-profile's own faction labels. For each cluster: who's in it by name (personas), where they landed, their shared framing, ONE short quote per cluster that typifies the position. Two or three sentences per cluster.

## Notable voices
Pick 3-5 specific reactions that carried the simulation's most decisive framing. Short quotes only (one sentence each, not full reactions). Attribute to the persona by name. These should be the lines a reader would remember.

## Surprises
Any persona whose stance moved significantly against type (e.g. a hawk softening toward de-escalation, an anti-imperialist defending an intervention, a neutral voice hardening). List at most two. Name the persona, name the topic, describe the drift in one sentence. If no significant against-type drift occurred, write: "No significant stance drift against type this run." — exactly that sentence, nothing more.

## Designer's takeaway
One sentence. What does this simulation tell the designer about how the input plays in front of this audience? Concrete and actionable, not generic.

STYLE RULES:
- Plain prose, no bullet points inside sections.
- Name personas by their full names as they appear in the simulation.
- Quote sparingly — one short quote per cluster in "Active factions", 3-5 short quotes in "Notable voices". Nowhere else.
- Total length target: 400-600 words. Longer than that is too long.
- Do NOT include tables, code blocks, or markdown headers beyond the ones specified.
- Do NOT end with a summary-of-the-summary paragraph. Stop after the Designer's takeaway sentence.
`;

// ─────────────────────────────────────────────────────────────
// Serialization helpers — turn SimulationState into prompt text
// ─────────────────────────────────────────────────────────────

function formatStanceRecord(record: Record<string, number>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return "(none)";
  return entries
    .map(([topic, value]) => `${topic}=${value.toFixed(2)}`)
    .join(", ");
}

function formatPersonaHeader(p: Persona): string {
  const stanceLine = formatStanceRecord(p.stance);
  const interestLine = formatStanceRecord(p.interest);
  const markers = p.style_markers.join("; ");
  return `### ${p.name} (${p.id})
Bio: ${p.bio}
Initial stance: ${stanceLine}
Initial interest: ${interestLine}
Style markers: ${markers}`;
}

function formatReaction(r: Reaction): string {
  const stanceDelta = formatStanceRecord(r.stance_delta);
  const interestDelta = formatStanceRecord(r.interest_delta);
  return `[Round ${r.round_n}] ${r.persona_id}
${r.text}
stance_delta: ${stanceDelta}
interest_delta: ${interestDelta}`;
}

/**
 * Aggregate per-topic stance drift across all rounds + all personas.
 * Returned as a sorted list (largest absolute drift first) so the
 * prompt surfaces the most-moved topics first for the LLM to anchor on.
 */
function aggregateStanceDrift(state: SimulationState): Array<[string, number]> {
  const totals: Record<string, number> = {};
  for (const round of state.rounds) {
    for (const reaction of round.reactions) {
      for (const [topic, delta] of Object.entries(reaction.stance_delta)) {
        totals[topic] = (totals[topic] ?? 0) + delta;
      }
    }
  }
  return Object.entries(totals).sort(
    ([, a], [, b]) => Math.abs(b) - Math.abs(a),
  );
}

export function buildSummaryPrompt(state: SimulationState): string {
  const parts: string[] = [];

  parts.push(`# Simulation ${state.id}`);
  parts.push("");
  parts.push(`Audience: ${state.audience.name} (id: ${state.audience.id})`);
  parts.push(`Agents: ${state.personas.length}`);
  parts.push(`Rounds: ${state.rounds.length}`);
  parts.push(`Status: ${state.status}`);
  parts.push("");

  parts.push("## Input document");
  parts.push("");
  parts.push(state.resolved_input_doc);
  parts.push("");

  parts.push("## Aggregate stance drift (topic: sum of deltas across all rounds)");
  parts.push("");
  const drift = aggregateStanceDrift(state);
  if (drift.length === 0) {
    parts.push("(no drift recorded)");
  } else {
    for (const [topic, total] of drift) {
      const sign = total >= 0 ? "+" : "";
      parts.push(`- ${topic}: ${sign}${total.toFixed(2)}`);
    }
  }
  parts.push("");

  parts.push("## Personas (final state after all rounds)");
  parts.push("");
  for (const p of state.personas) {
    parts.push(formatPersonaHeader(p));
    parts.push("");
  }

  parts.push("## Reactions (in order)");
  parts.push("");
  for (const round of state.rounds) {
    for (const reaction of round.reactions) {
      parts.push(formatReaction(reaction));
      parts.push("");
    }
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Main entry — one LLM call over serialized state
// ─────────────────────────────────────────────────────────────

/**
 * Run the summarization pass over a completed simulation state.
 * Consumes all of state.personas + state.rounds; produces structured
 * markdown per SUMMARY_SYSTEM_PROMPT.
 *
 * Caller is responsible for providing a ready-to-use LLMProvider
 * (the CLI wires OpenRouter / Ollama / dry-run via the provider
 * registry).
 */
export async function summarizeSimulation(
  state: SimulationState,
  provider: LLMProvider,
  opts: SummaryOptions = {},
): Promise<string> {
  const userBody = buildSummaryPrompt(state);
  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: userBody },
  ];
  const chatOpts: { temperature?: number; model?: string } = {
    temperature: opts.temperature ?? 0.4,
  };
  if (opts.model) chatOpts.model = opts.model;

  let buffer = "";
  for await (const chunk of provider.chat(messages, chatOpts)) {
    buffer += chunk;
  }
  return buffer.trim();
}
