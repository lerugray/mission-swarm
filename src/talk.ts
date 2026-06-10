// MissionSwarm — talk subcommand core (v-next).
//
// Converse with a persona from a COMPLETED simulation. The persona's
// reaction-mode framing is reused verbatim (REACTION_SYSTEM_PROMPT +
// buildPersonaIdentityBlock from simulation.ts), with a conversation-
// mode release clause lifting the JSON-reaction output requirement.
//
// Voice-consistency mitigation: the persona's OWN prior reactions are
// injected into the chat history as assistant turns, so the model sees
// "things I already said in this voice" rather than having to recover
// the voice from the bio alone. The original input document plus a
// compact digest of what the OTHER participants said form the
// preceding user context (own reactions are excluded from the digest —
// they're already present as assistant turns).
//
// The chat loop is a node:readline stdin loop. /quit exits; EOF on
// stdin exits gracefully. Each exchange is appended to
// simulations/<id>/talks/<persona-slug>-<n>.md as it completes, so a
// crashed session still leaves a transcript of what happened.

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "./providers/types";
import {
  REACTION_SYSTEM_PROMPT,
  buildPersonaIdentityBlock,
} from "./simulation";
import type { Persona, SimulationState } from "./types";

// ─────────────────────────────────────────────────────────────
// §1 Persona resolution
// ─────────────────────────────────────────────────────────────

export type PersonaResolution =
  | { ok: true; persona: Persona }
  | { ok: false; available: Persona[] };

/**
 * Resolve a persona by exact id first, then case-insensitive full-name
 * match. On a miss, returns the available persona list so the CLI can
 * print it before exiting non-zero.
 */
export function resolvePersona(
  personas: Persona[],
  query: string,
): PersonaResolution {
  const q = query.trim();
  const byId = personas.find((p) => p.id === q);
  if (byId) return { ok: true, persona: byId };
  const qLower = q.toLowerCase();
  const byName = personas.find(
    (p) => p.name.trim().toLowerCase() === qLower,
  );
  if (byName) return { ok: true, persona: byName };
  return { ok: false, available: personas };
}

// ─────────────────────────────────────────────────────────────
// §2 Context reconstruction
// ─────────────────────────────────────────────────────────────

const CONVERSATION_RELEASE_CLAUSE =
  "CONVERSATION MODE: the simulation has ended and you are now in a " +
  "direct conversation with the operator who ran it. Respond in " +
  "character, conversationally; no JSON. The strict-JSON reaction " +
  "format described above does NOT apply here — reply in plain prose, " +
  "in your own voice, as this persona.";

/**
 * Talk-mode system prompt: the reaction-mode system framing + the
 * persona identity block (bio / stance / interest / voice cues) + a
 * release clause lifting the JSON output format.
 */
export function buildTalkSystemPrompt(persona: Persona): string {
  return (
    REACTION_SYSTEM_PROMPT +
    "\n\n" +
    buildPersonaIdentityBlock(persona) +
    "\n\n" +
    CONVERSATION_RELEASE_CLAUSE
  );
}

/**
 * Compact digest of the simulation feed for the talk context: per
 * round, one truncated line per reaction from the OTHER participants.
 * The target persona's own reactions are excluded — they enter the
 * history as assistant turns instead.
 */
export function buildFeedDigest(
  state: SimulationState,
  excludePersonaId: string,
  maxCharsPerReaction = 160,
): string {
  const nameById = new Map(state.personas.map((p) => [p.id, p.name]));
  const chunks: string[] = [];
  for (const round of state.rounds) {
    const lines: string[] = [];
    for (const r of round.reactions) {
      if (r.persona_id === excludePersonaId) continue;
      const name = nameById.get(r.persona_id) ?? r.persona_id;
      const text =
        r.text.length > maxCharsPerReaction
          ? r.text.slice(0, maxCharsPerReaction - 1) + "…"
          : r.text;
      lines.push(`- ${name}: ${text}`);
    }
    if (lines.length > 0) {
      chunks.push(`Round ${round.number}:\n${lines.join("\n")}`);
    }
  }
  return chunks.join("\n") || "(no reactions from other participants)";
}

/**
 * Build the initial chat history for a talk session:
 *   [system]    reaction framing + persona block + release clause
 *   [user]      original input document + compact feed digest
 *   [assistant] the persona's own reaction, round 1
 *   [assistant] the persona's own reaction, round 2
 *   ...
 *
 * Own reactions land as assistant turns deliberately (voice-
 * consistency mitigation — the model anchors on its own prior
 * utterances in this voice). Consecutive assistant turns are accepted
 * by every provider this tool ships (OpenRouter / Ollama / claude-cli
 * / dry-run).
 */
export function buildTalkMessages(
  state: SimulationState,
  persona: Persona,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: buildTalkSystemPrompt(persona) },
    {
      role: "user",
      content:
        `INPUT DOCUMENT (what the simulation reacted to):\n` +
        `${state.resolved_input_doc}\n\n` +
        `FEED DIGEST (what the other participants said, by round):\n` +
        `${buildFeedDigest(state, persona.id)}\n\n` +
        `Your own reactions across the simulation follow, in order. ` +
        `After them, the conversation begins.`,
    },
  ];
  for (const round of state.rounds) {
    for (const r of round.reactions) {
      if (r.persona_id !== persona.id) continue;
      messages.push({ role: "assistant", content: r.text });
    }
  }
  return messages;
}

// ─────────────────────────────────────────────────────────────
// §3 Transcript path allocation
// ─────────────────────────────────────────────────────────────

export function slugifyPersonaName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "persona"
  );
}

/** First non-existing simulations/<id>/talks/<persona-slug>-<n>.md. */
export function nextTranscriptPath(simDir: string, persona: Persona): string {
  const talksDir = join(simDir, "talks");
  const slug = slugifyPersonaName(persona.name);
  let n = 1;
  while (existsSync(join(talksDir, `${slug}-${n}.md`))) n++;
  return join(talksDir, `${slug}-${n}.md`);
}

// ─────────────────────────────────────────────────────────────
// §4 The chat loop
// ─────────────────────────────────────────────────────────────

export interface TalkSessionOptions {
  state: SimulationState;
  persona: Persona;
  provider: LLMProvider;
  transcriptPath: string;
  chatOptions?: ChatOptions;
  /** Injectable for tests; defaults to process.stdin / process.stdout. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Run the interactive loop until /quit or EOF. Streams provider output
 * chunk-by-chunk; appends each completed exchange to the transcript.
 * Returns the number of exchanges completed.
 */
export async function runTalkSession(
  opts: TalkSessionOptions,
): Promise<number> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const { state, persona, provider, transcriptPath } = opts;

  await mkdir(join(transcriptPath, ".."), { recursive: true });
  await writeFile(
    transcriptPath,
    `# Talk with ${persona.name} (${persona.id})\n\n` +
      `Simulation: ${state.id}\n` +
      `Started: ${new Date().toISOString()}\n` +
      `Provider: ${provider.id}\n`,
    "utf8",
  );

  const messages = buildTalkMessages(state, persona);
  let exchanges = 0;

  output.write(
    `Talking with ${persona.name}. Type /quit to exit.\n\nyou> `,
  );
  const rl = createInterface({ input, terminal: false });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed === "/quit") break;
      if (trimmed === "") {
        output.write("you> ");
        continue;
      }
      messages.push({ role: "user", content: trimmed });
      output.write(`${persona.name}> `);
      let reply = "";
      for await (const chunk of provider.chat(messages, opts.chatOptions)) {
        reply += chunk;
        output.write(chunk);
      }
      if (!reply.endsWith("\n")) output.write("\n");
      messages.push({ role: "assistant", content: reply });
      exchanges++;
      await appendFile(
        transcriptPath,
        `\n## You\n\n${trimmed}\n\n## ${persona.name}\n\n${reply.trim()}\n`,
        "utf8",
      );
      output.write("you> ");
    }
  } finally {
    rl.close();
  }
  output.write("\n");
  return exchanges;
}

// ─────────────────────────────────────────────────────────────
// §5 Dry-run provider — canned conversational replies
// ─────────────────────────────────────────────────────────────

export function createDryRunTalkProvider(): LLMProvider {
  let n = 0;
  return {
    kind: "openrouter",
    id: "dry-run-talk",
    async *chat(messages: ChatMessage[]): AsyncIterable<string> {
      n++;
      const lastUser = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const echo = (lastUser?.content ?? "").slice(0, 80);
      yield (
        `(dry-run reply #${n}) Staying in character — you said: ` +
        `"${echo}". My position has not changed. We will see.`
      );
    },
  };
}
