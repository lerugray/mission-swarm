// MissionSwarm — council subcommand core (v-next).
//
// Mission-Companion's council pattern (src-tauri/src/council.rs)
// applied to swarm personas: each council voice answers the operator's
// question INDEPENDENTLY — one-shot, in parallel, with NO shared
// context and NO awareness of any other voice — then a SEPARATE
// synthesis call merges the successful answers into exactly three
// labelled sections: "Where they agree", "Where they differ",
// "Bottom line".
//
// DELIBERATION ROUNDS ARE DELIBERATELY REJECTED. The tempting
// alternative — let the voices see each other's answers and iterate —
// was considered and dropped for the same three reasons
// Mission-Companion locked the independent shape:
//   1. Latency: K voices × R deliberation rounds of serial LLM calls
//      vs one parallel fan-out + one synthesis call.
//   2. Opacity: after deliberation, the final position can't be
//      attributed to any voice — the value of a council is seeing the
//      independent priors, not a blended consensus artifact.
//   3. First-speaker anchoring: early answers drag later ones toward
//      themselves, collapsing exactly the variety the personas were
//      generated to provide.
//
// Failure policy (Mission-Companion rule): a voice that errors is
// EXCLUDED from synthesis, never fabricated over. Synthesis requires
// >= 2 successful answers; below that, the caller reports the answers
// it has plus a note instead of synthesizing.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "./providers/types";
import { buildPersonaIdentityBlock } from "./simulation";
import type { Persona } from "./types";

// ─────────────────────────────────────────────────────────────
// §1 Shapes + constants
// ─────────────────────────────────────────────────────────────

export const COUNCIL_AGREE_LABEL = "Where they agree";
export const COUNCIL_DIFFER_LABEL = "Where they differ";
export const COUNCIL_BOTTOM_LINE_LABEL = "Bottom line";

export const MIN_TAKES_FOR_SYNTHESIS = 2;

export interface CouncilTake {
  persona_id: string;
  persona_name: string;
  text: string;
}

export interface CouncilFailure {
  persona_id: string;
  persona_name: string;
  error: string;
}

export interface CouncilResult {
  takes: CouncilTake[];
  failures: CouncilFailure[];
  /** Null when fewer than MIN_TAKES_FOR_SYNTHESIS voices succeeded. */
  synthesis: string | null;
  /** Present when synthesis was skipped; explains why. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────
// §2 Prompt construction
// ─────────────────────────────────────────────────────────────

/**
 * One independent take. The persona answers alone — the prompt
 * explicitly forbids inventing or referencing other voices.
 * `documentContext` carries the original input document for
 * --from-sim councils (the council of people who just read it);
 * fresh-audience councils have no document.
 */
export function buildCouncilTakeMessages(
  persona: Persona,
  question: string,
  documentContext?: string,
): ChatMessage[] {
  const system =
    "You are one voice on an advisory council. You answer the " +
    "operator's question ALONE — you have NOT seen any other council " +
    "member's answer, and you must not invent, assume, or reference " +
    "one.\n\n" +
    buildPersonaIdentityBlock(persona) +
    "\n\n" +
    "Answer in character, in your own voice, in 2–6 sentences. Plain " +
    "prose — no JSON, no markdown headers. Take a real position; a " +
    "hedged non-answer is useless to the operator.";

  let user = "";
  if (documentContext) {
    user +=
      `For context, the document you previously read and reacted to:\n` +
      `${documentContext}\n\n`;
  }
  user += `QUESTION:\n${question}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * The synthesis call. Separate from the takes; sees only the
 * successful answers. Output shape is locked to exactly three
 * sections with these exact labels.
 */
export function buildSynthesisMessages(
  question: string,
  takes: CouncilTake[],
): ChatMessage[] {
  const system =
    "You are synthesizing an advisory council's independent answers to " +
    "the operator's question. Each voice answered alone, without seeing " +
    "the others. Your job is to surface the structure of their " +
    "agreement and disagreement — not to add your own opinion.\n\n" +
    "Produce EXACTLY three sections, with EXACTLY these markdown " +
    "headers, in this order, and nothing else:\n\n" +
    `## ${COUNCIL_AGREE_LABEL}\n` +
    "What the voices converge on. Attribute by name where useful.\n\n" +
    `## ${COUNCIL_DIFFER_LABEL}\n` +
    "The real fault lines — who disagrees with whom, and on what " +
    "grounds. Name names.\n\n" +
    `## ${COUNCIL_BOTTOM_LINE_LABEL}\n` +
    "One short paragraph: what the operator should take away.\n\n" +
    "RULES:\n" +
    "- Synthesize ONLY the answers given below. Voices that failed to " +
    "answer have been excluded — do not invent positions for them or " +
    "for anyone else.\n" +
    "- Quote sparingly; short fragments only.\n" +
    "- No preamble before the first header, no closing remarks after " +
    "the last section.";

  const body = takes
    .map((t) => `### ${t.persona_name}\n${t.text}`)
    .join("\n\n");
  const user =
    `QUESTION:\n${question}\n\n` +
    `COUNCIL ANSWERS (${takes.length} voices, each answered ` +
    `independently):\n\n${body}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ─────────────────────────────────────────────────────────────
// §3 Parallel takes + synthesis
// ─────────────────────────────────────────────────────────────

async function collectResponse(
  provider: LLMProvider,
  messages: ChatMessage[],
  chatOptions?: ChatOptions,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, chatOptions)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

export interface CollectCouncilTakesInput {
  personas: Persona[];
  question: string;
  provider: LLMProvider;
  chatOptions?: ChatOptions;
  documentContext?: string;
}

/**
 * Fan out one take per persona, all in parallel (same all-parallel
 * per-persona dispatch the round loop uses), with per-voice failure
 * isolation. Order of `takes` follows persona order, not completion
 * order, for stable output.
 */
export async function collectCouncilTakes(
  input: CollectCouncilTakesInput,
): Promise<{ takes: CouncilTake[]; failures: CouncilFailure[] }> {
  const outcomes = await Promise.all(
    input.personas.map(async (p) => {
      try {
        const messages = buildCouncilTakeMessages(
          p,
          input.question,
          input.documentContext,
        );
        const text = (
          await collectResponse(input.provider, messages, input.chatOptions)
        ).trim();
        if (text.length === 0) throw new Error("empty response");
        return {
          ok: true as const,
          take: { persona_id: p.id, persona_name: p.name, text },
        };
      } catch (err) {
        return {
          ok: false as const,
          failure: {
            persona_id: p.id,
            persona_name: p.name,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );
  const takes: CouncilTake[] = [];
  const failures: CouncilFailure[] = [];
  for (const o of outcomes) {
    if (o.ok) takes.push(o.take);
    else failures.push(o.failure);
  }
  return { takes, failures };
}

export interface RunCouncilInput {
  personas: Persona[];
  question: string;
  /** Provider for the per-persona takes. */
  takeProvider: LLMProvider;
  /** Provider for the synthesis call (the summarize provider path). */
  synthesisProvider: LLMProvider;
  chatOptions?: ChatOptions;
  documentContext?: string;
}

export async function runCouncil(
  input: RunCouncilInput,
): Promise<CouncilResult> {
  const { takes, failures } = await collectCouncilTakes({
    personas: input.personas,
    question: input.question,
    provider: input.takeProvider,
    ...(input.chatOptions ? { chatOptions: input.chatOptions } : {}),
    ...(input.documentContext
      ? { documentContext: input.documentContext }
      : {}),
  });

  if (takes.length < MIN_TAKES_FOR_SYNTHESIS) {
    return {
      takes,
      failures,
      synthesis: null,
      note:
        `Synthesis skipped: ${takes.length} successful answer(s), ` +
        `need at least ${MIN_TAKES_FOR_SYNTHESIS}. Failed voices are ` +
        `excluded, never fabricated over.`,
    };
  }

  const synthesis = (
    await collectResponse(
      input.synthesisProvider,
      buildSynthesisMessages(input.question, takes),
      input.chatOptions,
    )
  ).trim();
  return { takes, failures, synthesis };
}

// ─────────────────────────────────────────────────────────────
// §4 Persistence — simulations/council-<timestamp>/
// ─────────────────────────────────────────────────────────────

export interface CouncilRecord {
  id: string;
  question: string;
  source:
    | { kind: "audience"; audience_id: string; n_personas: number }
    | { kind: "from-sim"; sim_id: string; n_personas: number };
  created_at: string;
  takes: CouncilTake[];
  failures: CouncilFailure[];
  synthesis: string | null;
  note?: string;
}

export function formatCouncilMarkdown(record: CouncilRecord): string {
  const parts: string[] = [];
  parts.push(`# Council — ${record.id}`);
  parts.push("");
  parts.push(`**Question:** ${record.question}`);
  const src =
    record.source.kind === "audience"
      ? `audience \`${record.source.audience_id}\` ` +
        `(${record.source.n_personas} fresh personas)`
      : `simulation \`${record.source.sim_id}\` ` +
        `(${record.source.n_personas} evolved personas)`;
  parts.push(`**Source:** ${src}`);
  parts.push(`**Created:** ${record.created_at}`);
  parts.push("");
  parts.push("## Takes");
  parts.push("");
  for (const t of record.takes) {
    parts.push(`### ${t.persona_name}`);
    parts.push("");
    parts.push(t.text);
    parts.push("");
  }
  for (const f of record.failures) {
    parts.push(`### ${f.persona_name} (failed — excluded from synthesis)`);
    parts.push("");
    parts.push(`Error: ${f.error}`);
    parts.push("");
  }
  parts.push("## Synthesis");
  parts.push("");
  parts.push(record.synthesis ?? `(none) ${record.note ?? ""}`.trim());
  parts.push("");
  return parts.join("\n");
}

/** Write council.json + council.md under <simsDir>/<record.id>/. */
export async function persistCouncil(
  simsDir: string,
  record: CouncilRecord,
): Promise<string> {
  const dir = join(simsDir, record.id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "council.json"),
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    join(dir, "council.md"),
    formatCouncilMarkdown(record),
    "utf8",
  );
  return dir;
}

// ─────────────────────────────────────────────────────────────
// §5 Dry-run providers — canned takes + canned synthesis
// ─────────────────────────────────────────────────────────────

export function createDryRunCouncilTakeProvider(): LLMProvider {
  let n = 0;
  return {
    kind: "openrouter",
    id: "dry-run-council-take",
    async *chat(messages: ChatMessage[]): AsyncIterable<string> {
      n++;
      const system = messages.find((m) => m.role === "system");
      const m = system?.content.match(/YOU ARE: (.+)/);
      const name = m?.[1] ?? "A council voice";
      yield (
        `(dry-run take #${n}) ${name} weighs in: the plan is workable ` +
        `on its face, but the flank is exposed and nobody has priced ` +
        `the second-order costs. I would not sign off as written.`
      );
    },
  };
}

export function createDryRunSynthesisProvider(): LLMProvider {
  return {
    kind: "openrouter",
    id: "dry-run-council-synthesis",
    async *chat(): AsyncIterable<string> {
      yield (
        `## ${COUNCIL_AGREE_LABEL}\n\n` +
        `(dry-run) Every voice flagged the exposed flank and the ` +
        `unpriced second-order costs.\n\n` +
        `## ${COUNCIL_DIFFER_LABEL}\n\n` +
        `(dry-run) No real fault lines in canned output — voices ` +
        `differ only in register.\n\n` +
        `## ${COUNCIL_BOTTOM_LINE_LABEL}\n\n` +
        `(dry-run) Wiring verified; run without --dry-run for a real ` +
        `synthesis.`
      );
    },
  };
}
