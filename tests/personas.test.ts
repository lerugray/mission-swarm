// MissionSwarm — persona generator tests (ms-003)
//
// Uses a mock LLMProvider to exercise parsing, retry, and ID
// assignment without burning real tokens. Live provider testing
// is a separate (manual) validation step — the prompt-tuning
// taste call ms-003 flags.

import { describe, expect, test } from "bun:test";
import { generatePersonas, PersonaGenerationError } from "../src/personas";
import type { AudienceProfile } from "../src/types";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "../src/providers/types";

// ─────────────────────────────────────────────────────────────
// Mock provider helpers
// ─────────────────────────────────────────────────────────────

function mockProvider(responses: string[]): LLMProvider {
  let callIdx = 0;
  return {
    kind: "openrouter",
    id: "mock",
    async *chat(
      _messages: ChatMessage[],
      _options?: ChatOptions,
    ): AsyncIterable<string> {
      const r = responses[callIdx++];
      if (r === undefined) {
        throw new Error(`Mock provider exhausted — no response for call ${callIdx}`);
      }
      // Yield in a single chunk — real providers stream, but the
      // generator code accumulates anyway so output is identical.
      yield r;
    },
  };
}

const SAMPLE_AUDIENCE: AudienceProfile = {
  id: "test",
  name: "Test audience",
  description: "Generic test audience for unit tests.",
  persona_template_guidance:
    "Produce a small mix of domestic political factions + foreign observers.",
};

function canned3Personas(): string {
  return JSON.stringify([
    {
      name: "Col. Irina Volkov",
      bio: "Retired Russian military analyst. Writes a substack on escalation dynamics. Former GRU intelligence officer, skeptical of Western reporting.",
      stance: { sanctions: -0.7, escalation_risk: 0.5 },
      interest: { sanctions: 0.9, escalation_risk: 0.95 },
      style_markers: ["clipped military register", "cites Clausewitz"],
    },
    {
      name: "Ben Sanderson",
      bio: "Washington Post foreign-policy correspondent. Institutionalist, pro-NATO. 15 years covering Eastern Europe.",
      stance: { sanctions: 0.8, escalation_risk: -0.3 },
      interest: { sanctions: 0.85, escalation_risk: 0.7 },
      style_markers: ["newsroom formal", "uses 'analysts say' framing"],
    },
    {
      name: "Teodora Martín",
      bio: "Spanish leftist MEP. Anti-escalation, anti-sanctions. Published a book on 1936 Catalan syndicalism.",
      stance: { sanctions: -0.6, escalation_risk: -0.8 },
      interest: { sanctions: 0.7, escalation_risk: 0.9 },
      style_markers: ["rhetorical, uses historical parallels", "quotes Rosa Luxemburg"],
    },
  ]);
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("generatePersonas", () => {
  test("parses valid JSON and assigns deterministic ids", async () => {
    const personas = await generatePersonas({
      simulationId: "sim-abc",
      audience: SAMPLE_AUDIENCE,
      inputDoc: "Test input document body.",
      nAgents: 3,
      provider: mockProvider([canned3Personas()]),
    });

    expect(personas).toHaveLength(3);
    expect(personas[0]!.id).toBe("sim-abc-0");
    expect(personas[1]!.id).toBe("sim-abc-1");
    expect(personas[2]!.id).toBe("sim-abc-2");
    expect(personas[0]!.name).toBe("Col. Irina Volkov");
    expect(personas[0]!.stance.sanctions).toBe(-0.7);
    expect(personas[1]!.style_markers).toContain("newsroom formal");
  });

  test("handles markdown code-fence-wrapped JSON", async () => {
    const wrapped = "```json\n" + canned3Personas() + "\n```";
    const personas = await generatePersonas({
      simulationId: "sim-x",
      audience: SAMPLE_AUDIENCE,
      inputDoc: "doc",
      nAgents: 3,
      provider: mockProvider([wrapped]),
    });
    expect(personas).toHaveLength(3);
  });

  test("handles JSON preceded by preamble prose", async () => {
    const withPreamble =
      "Here are the personas you requested:\n\n" + canned3Personas();
    const personas = await generatePersonas({
      simulationId: "sim-y",
      audience: SAMPLE_AUDIENCE,
      inputDoc: "doc",
      nAgents: 3,
      provider: mockProvider([withPreamble]),
    });
    expect(personas).toHaveLength(3);
  });

  test("retries on malformed output and succeeds on second attempt", async () => {
    const personas = await generatePersonas({
      simulationId: "sim-r",
      audience: SAMPLE_AUDIENCE,
      inputDoc: "doc",
      nAgents: 3,
      provider: mockProvider([
        "I can't do that. Here is explanation instead.",
        canned3Personas(),
      ]),
    });
    expect(personas).toHaveLength(3);
  });

  test("throws after 3 failed parse attempts", async () => {
    await expect(
      generatePersonas({
        simulationId: "sim-fail",
        audience: SAMPLE_AUDIENCE,
        inputDoc: "doc",
        nAgents: 3,
        provider: mockProvider(["nope", "also nope", "still nope"]),
      }),
    ).rejects.toThrow(PersonaGenerationError);
  });

  test("throws when count doesn't match expected", async () => {
    const onlyOne = JSON.stringify([
      {
        name: "Solo",
        bio: "Only persona.",
        stance: { topic: 0 },
        interest: { topic: 0.5 },
        style_markers: ["flat"],
      },
    ]);
    // All 3 attempts return the same (wrong) count — should eventually throw.
    await expect(
      generatePersonas({
        simulationId: "sim-count",
        audience: SAMPLE_AUDIENCE,
        inputDoc: "doc",
        nAgents: 3,
        provider: mockProvider([onlyOne, onlyOne, onlyOne]),
      }),
    ).rejects.toThrow(PersonaGenerationError);
  });

  test("throws on duplicate names (diversity check)", async () => {
    const dupes = JSON.stringify([
      {
        name: "Same Person",
        bio: "a",
        stance: { t: 0.1 },
        interest: { t: 0.1 },
        style_markers: ["a"],
      },
      {
        name: "Same Person",
        bio: "b",
        stance: { t: 0.2 },
        interest: { t: 0.2 },
        style_markers: ["b"],
      },
    ]);
    await expect(
      generatePersonas({
        simulationId: "sim-dup",
        audience: SAMPLE_AUDIENCE,
        inputDoc: "doc",
        nAgents: 2,
        provider: mockProvider([dupes, dupes, dupes]),
      }),
    ).rejects.toThrow(/Duplicate persona names/);
  });

  test("rejects invalid nAgents", async () => {
    await expect(
      generatePersonas({
        simulationId: "sim-0",
        audience: SAMPLE_AUDIENCE,
        inputDoc: "doc",
        nAgents: 0,
        provider: mockProvider([canned3Personas()]),
      }),
    ).rejects.toThrow(PersonaGenerationError);
  });

  test("rejects non-finite numbers in stance", async () => {
    const bad = JSON.stringify([
      {
        name: "A",
        bio: "a",
        stance: { t: "not-a-number" }, // string, not number
        interest: { t: 0.5 },
        style_markers: ["x"],
      },
    ]);
    await expect(
      generatePersonas({
        simulationId: "sim-nan",
        audience: SAMPLE_AUDIENCE,
        inputDoc: "doc",
        nAgents: 1,
        provider: mockProvider([bad, bad, bad]),
      }),
    ).rejects.toThrow(PersonaGenerationError);
  });
});
