// MissionSwarm — reaction round loop (ms-004)
//
// For R rounds: for each persona, one LLM call producing
// { text, stance_delta, interest_delta }. Within a round, all
// personas run in parallel but see only the PREVIOUS round's feed —
// no cross-persona bleeding inside a round. Reactions stream to
// consumers as each LLM call completes (Promise.race), while
// persisted round state sorts reactions by persona order for stable
// diffs. After each round, state persists atomically and round N+1
// starts.
//
// Streaming: reactions emit a single "reaction-complete" JSON line
// to stdout as they settle so an operator watching can follow the
// run live. Full state.json is the structured sink.
//
// Failure policy: a single persona's reaction failing (parse error,
// timeout, transport) is logged + skipped — the round completes
// with fewer reactions than personas. Only when ALL personas in a
// round fail does the simulation abort. This matches the
// research-tool shape: a 17-of-20 reactions round is useful data;
// a 0-of-20 round signals a systemic issue (bad provider, broken
// prompt, network down) that warrants stopping.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "./providers/types";
import { ProviderError } from "./providers/types";
import type {
  Persona,
  Reaction,
  ReactionEvent,
  Round,
  SimulationState,
  Topic,
} from "./types";
import { applyReactionToPersona } from "./types";

// Emits one line per recorded reaction to stdout. Tests can
// override via setReactionEmitter to capture instead.
let reactionEmitter: (reaction: Reaction) => void = defaultEmit;
export function setReactionEmitter(fn: (reaction: Reaction) => void): void {
  reactionEmitter = fn;
}

/** Restore stdout JSON lines of {@link Reaction} (used after CLI overrides). */
export function resetReactionEmitter(): void {
  reactionEmitter = defaultEmit;
}

function defaultEmit(reaction: Reaction): void {
  process.stdout.write(JSON.stringify(reaction) + "\n");
}

export class SimulationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SimulationError";
  }
}

// ─────────────────────────────────────────────────────────────
// §0 ReactionEvent mapping (stream / CLI)
// ─────────────────────────────────────────────────────────────

export function reactionToReactionEvent(
  reaction: Reaction,
  personas: Persona[],
): ReactionEvent {
  const p = personas.find((x) => x.id === reaction.persona_id);
  const ev: ReactionEvent = {
    round: reaction.round_n,
    persona_name: p?.name ?? reaction.persona_id,
    reaction: reaction.text,
    stance_delta: reaction.stance_delta,
  };
  if (Object.keys(reaction.interest_delta).length > 0) {
    ev.interest_delta = reaction.interest_delta;
  }
  return ev;
}

// ─────────────────────────────────────────────────────────────
// §1 Public entry — run a full simulation
// ─────────────────────────────────────────────────────────────

export interface RunSimulationInput {
  /** Base state produced by ms-003's persona generator. Must have
   *  status: "pending", rounds: [], personas populated. */
  state: SimulationState;
  provider: LLMProvider;
  /** Directory to persist state.json + rounds into. Caller resolves
   *  the path (typically `simulations/<id>/`). */
  simulationsDir: string;
  /** Sliding window of prior-round feed tokens visible to each
   *  persona. 3 rounds is the default — tight enough to keep
   *  prompts small, wide enough to catch opinion drift. */
  feedWindowRounds?: number;
  /** Per-reaction LLM options forwarded to the provider. */
  chatOptions?: ChatOptions;
}

/**
 * Async generator: yields each {@link Reaction} the moment that persona's
 * LLM call completes (completion order), then returns the final
 * {@link SimulationState} when the run ends (complete or failed).
 */
export async function* iterateSimulation(
  input: RunSimulationInput,
): AsyncGenerator<Reaction, SimulationState> {
  const feedWindow = Math.max(1, input.feedWindowRounds ?? 3);
  let state: SimulationState = {
    ...input.state,
    status: "running",
  };
  await persistState(input.simulationsDir, state);

  for (let n = 1; n <= state.config.n_rounds; n++) {
    const startedAt = nowISO();
    const feed = buildFeedWindow(state.rounds, feedWindow);

    const pending = new Map(
      state.personas.map((persona) => {
        const pr = runOnePersonaReaction(
          persona,
          n,
          feed,
          state,
          input.provider,
          input.chatOptions,
        ).then((out) => ({ persona, out }));
        return [persona.id, pr] as const;
      }),
    );

    const completionOrder: Reaction[] = [];
    let failCount = 0;
    let lastErrMsg = "unknown";

    while (pending.size > 0) {
      const winner = await Promise.race(
        [...pending.entries()].map(([id, pr]) =>
          pr.then((v) => ({ id, ...v })),
        ),
      );
      pending.delete(winner.id);
      if (winner.out.ok) {
        completionOrder.push(winner.out.value);
        yield winner.out.value;
      } else {
        failCount++;
        logReactionFailure(n, winner.out.persona_id, winner.out.error);
        lastErrMsg = winner.out.error.message;
      }
    }

    if (failCount === state.personas.length) {
      state = {
        ...state,
        status: "failed",
        completed_at: nowISO(),
        failure_reason:
          `All ${failCount} personas failed in round ${n}. Last error: ${lastErrMsg}`,
      };
      await persistState(input.simulationsDir, state);
      return state;
    }

    const orderIdx = new Map(state.personas.map((p, i) => [p.id, i]));
    const reactions = [...completionOrder].sort(
      (a, b) =>
        (orderIdx.get(a.persona_id) ?? 0) - (orderIdx.get(b.persona_id) ?? 0),
    );

    const round: Round = {
      number: n,
      reactions,
      started_at: startedAt,
      completed_at: nowISO(),
    };

    const personasAfter = applyRoundToPersonas(state.personas, reactions);
    state = {
      ...state,
      rounds: [...state.rounds, round],
      personas: personasAfter,
    };
    await persistState(input.simulationsDir, state);
    await persistRoundJson(input.simulationsDir, state.id, round);
  }

  state = {
    ...state,
    status: "complete",
    completed_at: nowISO(),
  };
  await persistState(input.simulationsDir, state);
  return state;
}

export async function runSimulation(
  input: RunSimulationInput,
): Promise<SimulationState> {
  const gen = iterateSimulation(input);
  while (true) {
    const step = await gen.next();
    if (step.done) {
      return step.value;
    }
    reactionEmitter(step.value);
  }
}

// ─────────────────────────────────────────────────────────────
// §2 Per-persona reaction
// ─────────────────────────────────────────────────────────────

type PersonaReactionOutcome =
  | { ok: true; value: Reaction }
  | { ok: false; persona_id: string; error: Error };

async function runOnePersonaReaction(
  persona: Persona,
  roundN: number,
  feed: string,
  state: SimulationState,
  provider: LLMProvider,
  chatOptions: ChatOptions | undefined,
): Promise<PersonaReactionOutcome> {
  const messages = buildReactionPrompt(persona, roundN, feed, state);
  try {
    const raw = await collectResponse(provider, messages, chatOptions);
    const parsed = parseReactionJson(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        persona_id: persona.id,
        error: new SimulationError(
          `Persona ${persona.id} round ${roundN}: parse failed. ${parsed.error.message}. ` +
            `Raw (truncated): ${raw.slice(0, 200)}`,
          parsed.error,
        ),
      };
    }
    return {
      ok: true,
      value: {
        round_n: roundN,
        persona_id: persona.id,
        text: parsed.value.text,
        stance_delta: parsed.value.stance_delta,
        interest_delta: parsed.value.interest_delta,
      },
    };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      persona_id: persona.id,
      error:
        err instanceof ProviderError
          ? new SimulationError(
              `Persona ${persona.id} round ${roundN}: provider error (${err.name}) — ${err.message}`,
              err,
            )
          : e,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// §3 Prompt construction
// ─────────────────────────────────────────────────────────────

function buildReactionPrompt(
  persona: Persona,
  roundN: number,
  feed: string,
  state: SimulationState,
): ChatMessage[] {
  const system =
    "You are one participant in a swarm simulation. Your identity is fixed — " +
    "you react AS this persona, in this persona's voice. You see the input " +
    "document and the recent reactions of other participants (the feed). " +
    "You do NOT see other participants' private stance or interest deltas.\n\n" +
    "Each round you emit ONE reaction: a short statement in your voice " +
    "(1–4 sentences, plausibly something this persona might say in " +
    "response to the current state of play), plus sparse stance and interest " +
    "updates on topics you chose to move on this round.\n\n" +
    "Output STRICT JSON. A single object. No markdown code fence. No prose " +
    "before or after. Keys:\n" +
    '  text: string — your reaction in your voice\n' +
    '  stance_delta: object — topic → delta in −1..+1. Sparse: only topics ' +
    'you meaningfully moved. Omit topics you did not move. Values are DELTAS, ' +
    'not absolute.\n' +
    '  interest_delta: object — same topic keys or new ones, → delta in −1..+1. ' +
    'Same sparse semantics.\n\n' +
    "Voice guidance: stay in character. Don't say \"as an AI\". Don't narrate " +
    "that you are a simulation. Respond as the persona to the situation.";

  const topicsKnown = unionTopicKeys(persona);
  const stanceSummary = Object.entries(persona.stance)
    .map(([t, v]) => `${t}=${v.toFixed(2)}`)
    .join(", ") || "(none yet)";
  const interestSummary = Object.entries(persona.interest)
    .map(([t, v]) => `${t}=${v.toFixed(2)}`)
    .join(", ") || "(none yet)";

  const user =
    `YOU ARE: ${persona.name}\n` +
    `BIO: ${persona.bio}\n` +
    `VOICE CUES: ${persona.style_markers.join(" • ")}\n` +
    `YOUR CURRENT STANCE: ${stanceSummary}\n` +
    `YOUR CURRENT INTEREST: ${interestSummary}\n` +
    `TOPICS YOU'VE STAKED: ${topicsKnown.join(", ") || "(none)"}\n\n` +
    `INPUT DOCUMENT:\n${state.resolved_input_doc}\n\n` +
    `RECENT FEED (other participants' reactions, most recent first):\n` +
    `${feed || "(this is round 1 — no prior reactions yet)"}\n\n` +
    `This is ROUND ${roundN} of ${state.config.n_rounds}. Emit your reaction as JSON.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function unionTopicKeys(persona: Persona): Topic[] {
  const seen = new Set<Topic>();
  for (const t of Object.keys(persona.stance)) seen.add(t);
  for (const t of Object.keys(persona.interest)) seen.add(t);
  return [...seen];
}

// ─────────────────────────────────────────────────────────────
// §4 Feed window — what each persona sees of prior rounds
// ─────────────────────────────────────────────────────────────

function buildFeedWindow(rounds: Round[], windowSize: number): string {
  if (rounds.length === 0) return "";
  const slice = rounds.slice(-windowSize);
  // Most recent round first — "first" in the prompt order matches
  // "most recent" in conversational feel.
  const orderedRecentFirst = [...slice].reverse();
  const chunks: string[] = [];
  for (const r of orderedRecentFirst) {
    chunks.push(`--- Round ${r.number} ---`);
    for (const rx of r.reactions) {
      chunks.push(`${rx.persona_id}: ${rx.text}`);
    }
  }
  return chunks.join("\n");
}

// ─────────────────────────────────────────────────────────────
// §5 JSON parsing of the reaction response
// ─────────────────────────────────────────────────────────────

interface RawReaction {
  text: string;
  stance_delta: Record<Topic, number>;
  interest_delta: Record<Topic, number>;
}

type ReactionParseResult =
  | { ok: true; value: RawReaction }
  | { ok: false; error: Error };

function parseReactionJson(raw: string): ReactionParseResult {
  const candidates = [raw.trim(), stripCodeFence(raw.trim()), extractFirstJsonObject(raw)];
  let lastErr: Error = new Error("unknown");
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastErr = new Error(`Expected top-level JSON object, got ${typeof parsed}`);
        continue;
      }
      const shaped = shapeRawReaction(parsed);
      if (!shaped.ok) {
        lastErr = shaped.error;
        continue;
      }
      return { ok: true, value: shaped.value };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  return { ok: false, error: lastErr };
}

function shapeRawReaction(v: unknown): ReactionParseResult {
  if (v == null || typeof v !== "object") {
    return { ok: false, error: new Error("not an object") };
  }
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string" || o.text.length === 0) {
    return { ok: false, error: new Error("missing or empty 'text'") };
  }
  const stance = shapeNumberRecord(o.stance_delta, "stance_delta");
  if (!stance.ok) return { ok: false, error: stance.error };
  const interest = shapeNumberRecord(o.interest_delta, "interest_delta");
  if (!interest.ok) return { ok: false, error: interest.error };
  return {
    ok: true,
    value: {
      text: o.text,
      stance_delta: stance.value,
      interest_delta: interest.value,
    },
  };
}

function shapeNumberRecord(
  v: unknown,
  field: string,
):
  | { ok: true; value: Record<Topic, number> }
  | { ok: false; error: Error } {
  if (v == null) return { ok: true, value: {} };
  if (typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: new Error(`${field} must be an object`) };
  }
  const out: Record<Topic, number> = {};
  for (const [k, raw] of Object.entries(v)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: new Error(`${field}.${k} not numeric`) };
    }
    out[k] = n;
  }
  return { ok: true, value: out };
}

function stripCodeFence(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1]!.trim() : s;
}

function extractFirstJsonObject(s: string): string {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// §6 Delta application across all personas in a round
// ─────────────────────────────────────────────────────────────

function applyRoundToPersonas(personas: Persona[], reactions: Reaction[]): Persona[] {
  const byId = new Map<string, Reaction>();
  for (const r of reactions) byId.set(r.persona_id, r);
  return personas.map((p) => {
    const r = byId.get(p.id);
    return r ? applyReactionToPersona(p, r) : p;
  });
}

// ─────────────────────────────────────────────────────────────
// §7 Provider response collection
// ─────────────────────────────────────────────────────────────

async function collectResponse(
  provider: LLMProvider,
  messages: ChatMessage[],
  chatOptions: ChatOptions | undefined,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of provider.chat(messages, chatOptions)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

// ─────────────────────────────────────────────────────────────
// §8 State persistence — simulations/<id>/state.json
// ─────────────────────────────────────────────────────────────

export async function persistState(
  simulationsDir: string,
  state: SimulationState,
): Promise<string> {
  const dir = join(simulationsDir, state.id);
  const path = join(dir, "state.json");
  await atomicWriteJson(path, state);
  return path;
}

export async function persistRoundJson(
  simulationsDir: string,
  simId: string,
  round: Round,
): Promise<string> {
  const dir = join(simulationsDir, simId);
  const path = join(dir, `round-${round.number}.json`);
  await atomicWriteJson(path, round);
  return path;
}

export async function loadState(
  simulationsDir: string,
  id: string,
): Promise<SimulationState | null> {
  const path = join(simulationsDir, id, "state.json");
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as SimulationState;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

// ─────────────────────────────────────────────────────────────
// §9 Observability helpers
// ─────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function logReactionFailure(roundN: number, personaId: string, err: Error): void {
  process.stderr.write(
    `[missionswarm round ${roundN}] persona ${personaId} reaction failed: ${err.message}\n`,
  );
}
