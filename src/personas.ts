// MissionSwarm — persona generator (ms-003)
//
// Given an input document + audience profile + target count, asks
// the LLM to generate a set of personas with deliberate stance
// variety. Single-shot LLM call; parses the response as strict
// JSON; retries up to 2 extra times on malformed output.
//
// Deterministic id assignment happens post-parse: the LLM is NOT
// trusted to produce ids. This keeps ids collision-free across
// re-runs and keeps the prompt simpler.

import type {
  AudienceProfile,
  Persona,
  StanceValue,
  InterestValue,
} from "./types";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "./providers/types";
import { ProviderError } from "./providers/types";

const MAX_RETRIES = 2; // 3 total attempts

export class PersonaGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "PersonaGenerationError";
  }
}

export interface GeneratePersonasInput {
  simulationId: string;
  audience: AudienceProfile;
  inputDoc: string;
  nAgents: number;
  provider: LLMProvider;
  /** Optional per-call options forwarded to the provider. */
  chatOptions?: ChatOptions;
}

export async function generatePersonas(
  input: GeneratePersonasInput,
): Promise<Persona[]> {
  if (input.nAgents < 1) {
    throw new PersonaGenerationError(
      `nAgents must be >= 1, got ${input.nAgents}`,
    );
  }

  const messages = buildPersonaPrompt(input);

  let lastRaw = "";
  let lastParseErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let raw: string;
    try {
      raw = await collectResponse(input.provider, messages, input.chatOptions);
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new PersonaGenerationError(
          `LLM call failed: ${err.message}`,
          err,
        );
      }
      throw err;
    }
    lastRaw = raw;

    const parseResult = parsePersonasJson(raw);
    if (parseResult.ok) {
      const parsed = parseResult.value;
      validateParsed(parsed, input.nAgents);
      return parsed.map((p, i) => ({
        id: `${input.simulationId}-${i}`,
        name: p.name,
        bio: p.bio,
        stance: p.stance,
        interest: p.interest,
        style_markers: p.style_markers,
      }));
    }
    lastParseErr = parseResult.error;

    if (attempt < MAX_RETRIES) {
      // On retry, append a corrective user message rather than
      // starting over. The LLM saw its own malformed output in
      // the transcript and is more likely to self-correct than
      // if we just replayed the original prompt.
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          "Your previous response was not valid JSON matching the required shape. " +
          "Return ONLY a raw JSON array (no markdown fences, no commentary). " +
          "Each element must have exactly these keys: name (string), bio (string), " +
          "stance (object, topic→number in −1..+1), interest (object, topic→number in 0..1), " +
          `style_markers (array of strings). Return exactly ${input.nAgents} elements.`,
      });
    }
  }

  throw new PersonaGenerationError(
    `Persona parse failed after ${MAX_RETRIES + 1} attempts. ` +
      `Last error: ${(lastParseErr as Error)?.message ?? String(lastParseErr)}. ` +
      `Last raw output (truncated): ${lastRaw.slice(0, 300)}`,
    lastParseErr,
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────

function buildPersonaPrompt(input: GeneratePersonasInput): ChatMessage[] {
  const system =
    "You are a persona generator for MissionSwarm, a swarm-simulation tool. " +
    "Given an input document and an audience template, you generate a set of " +
    "personas — each a plausible reacting participant with a defined stance, " +
    "interest profile, voice, and background. Personas must show DELIBERATE " +
    "VARIETY — no two should share the same stance profile, and the set should " +
    "span the plausible response spectrum for the audience (supportive, " +
    "skeptical, hostile, ambivalent, disengaged, etc.). " +
    "\n\n" +
    "Output STRICT JSON. A bare array. No markdown code fence. No prose before " +
    "or after. Each persona is an object with exactly these keys:\n" +
    "  name: string — a plausible full name for the persona\n" +
    "  bio: string — 2–4 sentences. Backstory + voice cues. This is the full " +
    "prompt-context the persona uses in subsequent rounds, so pack in concrete " +
    "details (role, era, affiliation, key priors).\n" +
    "  stance: object — topic name → number in −1..+1 " +
    "(−1 = maximum opposition, +1 = maximum support, 0 = neutral). " +
    "Topics are emergent — pick the ones the input document actually touches. " +
    "Include 3–6 topics per persona.\n" +
    "  interest: object — same topic keys as stance → number in 0..1 " +
    "(how much this persona cares, 0 = will ignore, 1 = central to identity).\n" +
    "  style_markers: array of strings — 2–4 concrete voice cues " +
    "(\"speaks in clipped military register\", \"quotes poetry\", " +
    "\"uses legal vocabulary\", \"sprinkles Yiddish loanwords\").\n" +
    "\n" +
    "Do NOT include an 'id' field. Do NOT include explanatory text. Output " +
    "must be parseable by JSON.parse() directly.";

  const user =
    `INPUT DOCUMENT:\n${input.inputDoc}\n\n` +
    `AUDIENCE: ${input.audience.name}\n` +
    `${input.audience.description}\n\n` +
    `PERSONA GUIDANCE:\n${input.audience.persona_template_guidance}\n\n` +
    `Generate ${input.nAgents} personas as a JSON array.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ─────────────────────────────────────────────────────────────
// Response collection + parsing
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

interface RawPersona {
  name: string;
  bio: string;
  stance: Record<string, StanceValue>;
  interest: Record<string, InterestValue>;
  style_markers: string[];
}

type ParseResult =
  | { ok: true; value: RawPersona[] }
  | { ok: false; error: Error };

/**
 * Strip common LLM wrapper artifacts (markdown fences, "Here is..." prose)
 * before attempting JSON.parse. If a model ignored the instruction to emit
 * raw JSON, this rescues most of those cases without a retry.
 */
function parsePersonasJson(raw: string): ParseResult {
  // Try a series of progressively-more-forgiving parses.
  const candidates = [
    raw.trim(),
    stripCodeFence(raw.trim()),
    extractFirstJsonArray(raw),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as unknown;
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: new Error(`Expected top-level JSON array, got ${typeof parsed}`),
        };
      }
      const personas: RawPersona[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i] as unknown;
        const shaped = shapeRawPersona(p, i);
        if (!shaped.ok) return { ok: false, error: shaped.error };
        personas.push(shaped.value);
      }
      return { ok: true, value: personas };
    } catch (err) {
      // Try the next candidate.
      continue;
    }
  }
  return { ok: false, error: new Error("No parse candidate yielded valid JSON") };
}

function stripCodeFence(s: string): string | null {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(s);
  return m && m[1] !== undefined ? m[1].trim() : null;
}

function extractFirstJsonArray(s: string): string | null {
  // Greedy-but-balanced: find the first '[' and scan to its match.
  const start = s.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

type ShapeResult =
  | { ok: true; value: RawPersona }
  | { ok: false; error: Error };

function shapeRawPersona(obj: unknown, idx: number): ShapeResult {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: new Error(`Element ${idx} is not an object`) };
  }
  const o = obj as Record<string, unknown>;

  if (typeof o.name !== "string" || o.name.length === 0) {
    return { ok: false, error: new Error(`Element ${idx}: missing or invalid 'name'`) };
  }
  if (typeof o.bio !== "string" || o.bio.length === 0) {
    return { ok: false, error: new Error(`Element ${idx}: missing or invalid 'bio'`) };
  }
  const stance = shapeTopicMap(o.stance, idx, "stance");
  if (!stance.ok) return stance;
  const interestSource = o.interest ?? o.interests;
  const interest = shapeTopicMap(interestSource, idx, "interest");
  if (!interest.ok) return interest;

  const markersField =
    o.style_markers ??
    (typeof o.style === "string"
      ? [o.style]
      : Array.isArray(o.style)
        ? o.style
        : undefined);

  if (!Array.isArray(markersField)) {
    return {
      ok: false,
      error: new Error(
        `Element ${idx}: 'style_markers' (or 'style') must be an array or string`,
      ),
    };
  }
  const markers: string[] = [];
  for (const m of markersField) {
    if (typeof m !== "string") {
      return {
        ok: false,
        error: new Error(`Element ${idx}: 'style_markers' must be all strings`),
      };
    }
    markers.push(m);
  }

  return {
    ok: true,
    value: {
      name: o.name,
      bio: o.bio,
      stance: stance.value,
      interest: interest.value,
      style_markers: markers,
    },
  };
}

type TopicMapShape =
  | { ok: true; value: Record<string, number> }
  | { ok: false; error: Error };

function shapeTopicMap(v: unknown, idx: number, key: string): TopicMapShape {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: new Error(`Element ${idx}: '${key}' must be an object`) };
  }
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return {
        ok: false,
        error: new Error(`Element ${idx}: '${key}.${k}' must be a finite number`),
      };
    }
    out[k] = n;
  }
  return { ok: true, value: out };
}

// ─────────────────────────────────────────────────────────────
// Post-parse validation
// ─────────────────────────────────────────────────────────────

function validateParsed(parsed: RawPersona[], expectedCount: number): void {
  if (parsed.length !== expectedCount) {
    throw new PersonaGenerationError(
      `Expected ${expectedCount} personas, got ${parsed.length}`,
    );
  }
  // Diversity check — simple heuristic: all names must be distinct.
  // The prompt asks for stance diversity too, but post-hoc stance
  // checking would need a tolerance threshold (how close is "too
  // close"?) that we don't have good defaults for yet. Name
  // distinctness is a weak but cheap sanity check that catches
  // the obvious failure mode (LLM produces duplicates).
  const names = new Set(parsed.map((p) => p.name.trim().toLowerCase()));
  if (names.size !== parsed.length) {
    throw new PersonaGenerationError(
      `Duplicate persona names detected — LLM did not produce a distinct set`,
    );
  }
}
