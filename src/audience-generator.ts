// MissionSwarm — audience generator (ms-011).
//
// Given a short user description and a few existing audiences as
// few-shot examples, produces a complete audiences/<id>.json file
// suitable for the persona generator (ms-003) to consume.
//
// Design notes:
//  - One LLM call with up to 3 reference exemplars in the prompt.
//    The exemplars carry the quality bar — TEMPLATE GROUPS section,
//    CRAFT RULES section, voice register — better than any
//    description we could write into the system prompt.
//  - The user-supplied `id` is authoritative. The LLM may emit an
//    id field; we overwrite it on parse so the file path matches
//    the CLI flag. Same for description if the user supplied one
//    explicitly (versus letting the LLM polish it).
//  - One retry on malformed JSON. Audience generation is single-shot
//    (one object, not an array of personas) so the recovery surface
//    is smaller than personas.ts; two retries felt like overkill.
//  - `persona_template_guidance` length floor of 800 chars. The
//    shipped audiences are 4000–8000 chars; below 800 the output is
//    almost certainly a refusal or truncation.

import type { AudienceProfile } from "./types";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "./providers/types";
import { ProviderError } from "./providers/types";

const MAX_RETRIES = 1; // 2 total attempts
const MIN_GUIDANCE_LENGTH = 800;
// Audience generation produces ~1500 output tokens of structured prose.
// The provider default of 60s (tuned for ~500-token persona reactions)
// is too tight — flagship models routinely take 90-150s for this size.
const DEFAULT_TIMEOUT_MS = 180_000;

export class AudienceGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "AudienceGenerationError";
  }
}

export interface GenerateAudienceInput {
  /** Slug-form audience id. Becomes the filename and is forced into
   * the returned profile (overrides any id the LLM emits). */
  id: string;
  /** Plain-English description of the audience. Goes into the
   * prompt verbatim; also becomes the profile's `description`
   * field unless the LLM polishes it (which we accept). */
  description: string;
  /** Target number of TEMPLATE GROUPS in the generated guidance.
   * Default 4 (matches kriegspiel.json shape). */
  nGroups?: number;
  /** Reference audiences to include as few-shot examples. Caller
   * controls selection + ordering. Empty array is allowed (the
   * model will work harder, but won't fail). */
  exemplars: AudienceProfile[];
  provider: LLMProvider;
  /** Optional per-call options forwarded to the provider. */
  chatOptions?: ChatOptions;
}

export async function generateAudience(
  input: GenerateAudienceInput,
): Promise<AudienceProfile> {
  if (!input.id || !input.id.trim()) {
    throw new AudienceGenerationError("id is required");
  }
  if (!input.description || !input.description.trim()) {
    throw new AudienceGenerationError("description is required");
  }
  const nGroups = input.nGroups ?? 4;
  if (nGroups < 1) {
    throw new AudienceGenerationError(`nGroups must be >= 1, got ${nGroups}`);
  }

  const messages = buildAudiencePrompt(input, nGroups);
  const chatOptions: ChatOptions = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...input.chatOptions,
  };

  let lastRaw = "";
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let raw: string;
    try {
      raw = await collectResponse(input.provider, messages, chatOptions);
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new AudienceGenerationError(
          `LLM call failed: ${err.message}`,
          err,
        );
      }
      throw err;
    }
    lastRaw = raw;

    const parsed = parseAudienceJson(raw);
    if (parsed.ok) {
      try {
        return finalizeProfile(parsed.value, input);
      } catch (err) {
        lastErr = err;
        // Validation failed (e.g., guidance too short) — fall through to retry.
      }
    } else {
      lastErr = parsed.error;
    }

    if (attempt < MAX_RETRIES) {
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          "Your previous response did not match the required shape. " +
          "Return ONLY a raw JSON object (no markdown fence, no commentary) with these keys: " +
          'id (string), name (string), description (string), persona_template_guidance (string of at least ' +
          `${MIN_GUIDANCE_LENGTH} characters with TEMPLATE GROUPS and CRAFT RULES sections).`,
      });
    }
  }

  throw new AudienceGenerationError(
    `Audience generation failed after ${MAX_RETRIES + 1} attempts. ` +
      `Last error: ${(lastErr as Error)?.message ?? String(lastErr)}. ` +
      `Last raw output (truncated): ${lastRaw.slice(0, 300)}`,
    lastErr,
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────

function buildAudiencePrompt(
  input: GenerateAudienceInput,
  nGroups: number,
): ChatMessage[] {
  const system =
    "You generate audience profiles for MissionSwarm, a swarm-simulation tool. " +
    "An audience profile is a JSON object with four fields: id, name, description, " +
    "persona_template_guidance. The persona_template_guidance is the heart of the file " +
    "— it is downstream prompt-text fed to a persona-generator LLM, telling it what " +
    "kind of personas to produce for a given input document.\n\n" +
    "Quality bar: persona_template_guidance must be a structured prose document of " +
    "roughly 4000–8000 characters with two named sections — TEMPLATE GROUPS (the kinds " +
    "of personas to generate, with target percentages) and CRAFT RULES (constraints on " +
    "naming, bios, stance variety, style markers). Voice register matches the reference " +
    `examples: specific, opinionated, anti-archetype. Aim for ${nGroups} template groups ` +
    "unless the audience description naturally suggests a different shape.\n\n" +
    "Output STRICT JSON. A bare object. No markdown code fence. No prose before or after. " +
    "The output must be parseable by JSON.parse() directly.";

  const exemplarsBlock = renderExemplars(input.exemplars);
  const user =
    `${exemplarsBlock}NEW AUDIENCE TO GENERATE\n\n` +
    `id: ${input.id}\n` +
    `description: ${input.description}\n` +
    `target template groups: ${nGroups}\n\n` +
    "Produce the JSON object now. Match the structure and quality of the reference " +
    "examples. The persona_template_guidance section is what matters most — it must be " +
    "long enough and concrete enough to drive a downstream LLM to produce specific, " +
    "non-generic personas.";

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function renderExemplars(exemplars: AudienceProfile[]): string {
  if (exemplars.length === 0) return "";
  const blocks: string[] = ["REFERENCE EXAMPLES\n"];
  for (const ex of exemplars) {
    blocks.push(`--- audience: ${ex.id} ---`);
    blocks.push(JSON.stringify(ex, null, 2));
    blocks.push("");
  }
  blocks.push("");
  return blocks.join("\n");
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

interface RawAudience {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  persona_template_guidance?: unknown;
}

type ParseResult =
  | { ok: true; value: RawAudience }
  | { ok: false; error: Error };

function parseAudienceJson(raw: string): ParseResult {
  const candidates = [
    raw.trim(),
    stripCodeFence(raw.trim()),
    extractFirstJsonObject(raw),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          ok: false,
          error: new Error(
            `Expected top-level JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
          ),
        };
      }
      return { ok: true, value: parsed as RawAudience };
    } catch {
      continue;
    }
  }
  return { ok: false, error: new Error("No parse candidate yielded valid JSON") };
}

function stripCodeFence(s: string): string | null {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(s);
  return m && m[1] !== undefined ? m[1].trim() : null;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
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
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Finalize: validate + force user-provided id
// ─────────────────────────────────────────────────────────────

function finalizeProfile(
  raw: RawAudience,
  input: GenerateAudienceInput,
): AudienceProfile {
  const guidance = raw.persona_template_guidance;
  if (typeof guidance !== "string" || guidance.length < MIN_GUIDANCE_LENGTH) {
    throw new AudienceGenerationError(
      `persona_template_guidance missing or too short ` +
        `(got ${typeof guidance === "string" ? `${guidance.length} chars` : typeof guidance}, ` +
        `need >= ${MIN_GUIDANCE_LENGTH})`,
    );
  }
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : input.id;
  // Prefer LLM-polished description if it produced one substantively
  // longer than the input; otherwise keep the input as-is.
  const llmDesc =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : "";
  const description =
    llmDesc && llmDesc.length >= input.description.length
      ? llmDesc
      : input.description;

  return {
    id: input.id, // authoritative — overrides any id the LLM emitted
    name,
    description,
    persona_template_guidance: guidance,
  };
}
