// MissionSwarm — summary tests (ms-009)
//
// Exercises the post-simulation summarization module against a mock
// provider so prompt assembly, provider invocation, and output
// concatenation are verified without burning tokens. The
// voice-bearing SUMMARY_SYSTEM_PROMPT itself is tuned via live runs,
// not unit tests — these tests verify plumbing, not wording.

import { describe, expect, test } from "bun:test";

import {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
  summarizeSimulation,
} from "../src/summary";
import type {
  AudienceProfile,
  Persona,
  Reaction,
  SimulationState,
} from "../src/types";
import type { ChatMessage, LLMProvider } from "../src/providers/types";

// ─────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────

const AUDIENCE: AudienceProfile = {
  id: "test-audience",
  name: "Test audience",
  description: "Fixture audience for summary tests",
  persona_template_guidance: "irrelevant for these tests",
};

function makePersona(i: number): Persona {
  return {
    id: `sim-test-${i}`,
    name: `Persona ${i}`,
    bio: `Bio for persona ${i}`,
    stance: { alpha: 0.5, beta: -0.3 },
    interest: { alpha: 0.8, beta: 0.6 },
    style_markers: [`marker-${i}-a`, `marker-${i}-b`],
  };
}

function makeReaction(roundN: number, personaIdx: number, deltas: Record<string, number>): Reaction {
  return {
    round_n: roundN,
    persona_id: `sim-test-${personaIdx}`,
    text: `Round ${roundN} from persona ${personaIdx}. The audience reacted.`,
    stance_delta: deltas,
    interest_delta: { alpha: 0.05 },
  };
}

function makeCompleteState(): SimulationState {
  const personas = [makePersona(0), makePersona(1), makePersona(2)];
  return {
    id: "sim-test-complete",
    config: {
      input_doc: "Test input document about a policy announcement.",
      audience_profile_id: "test-audience",
      n_agents: 3,
      n_rounds: 2,
    },
    audience: AUDIENCE,
    resolved_input_doc: "Test input document about a policy announcement.",
    personas,
    rounds: [
      {
        number: 1,
        reactions: [
          makeReaction(1, 0, { alpha: -0.1, beta: 0.2 }),
          makeReaction(1, 1, { alpha: -0.05, gamma: 0.3 }),
          makeReaction(1, 2, { alpha: 0.4 }),
        ],
        started_at: "2026-04-24T12:00:00Z",
        completed_at: "2026-04-24T12:00:30Z",
      },
      {
        number: 2,
        reactions: [
          makeReaction(2, 0, { alpha: -0.2 }),
          makeReaction(2, 1, { beta: 0.5 }),
          makeReaction(2, 2, { gamma: -0.1 }),
        ],
        started_at: "2026-04-24T12:01:00Z",
        completed_at: "2026-04-24T12:01:30Z",
      },
    ],
    status: "complete",
    started_at: "2026-04-24T12:00:00Z",
    completed_at: "2026-04-24T12:01:30Z",
  };
}

class MockProvider implements LLMProvider {
  kind: "openrouter" = "openrouter";
  id = "mock";
  captured: ChatMessage[] = [];
  response: string;

  constructor(response: string) {
    this.response = response;
  }

  async *chat(messages: ChatMessage[]): AsyncIterable<string> {
    this.captured = messages;
    // Yield in two chunks to exercise concatenation.
    const mid = Math.floor(this.response.length / 2);
    yield this.response.slice(0, mid);
    yield this.response.slice(mid);
  }
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("buildSummaryPrompt", () => {
  test("includes input doc, personas, reactions, and aggregate drift", () => {
    const state = makeCompleteState();
    const prompt = buildSummaryPrompt(state);

    expect(prompt).toContain("sim-test-complete");
    expect(prompt).toContain("Test input document about a policy announcement.");
    expect(prompt).toContain("Persona 0");
    expect(prompt).toContain("Persona 1");
    expect(prompt).toContain("Persona 2");
    expect(prompt).toContain("Bio for persona 0");
    expect(prompt).toContain("marker-1-a");
    expect(prompt).toContain("Round 1 from persona 0");
    expect(prompt).toContain("Round 2 from persona 2");
    expect(prompt).toContain("Aggregate stance drift");
  });

  test("aggregate stance drift sorts by absolute value, shows signs", () => {
    const state = makeCompleteState();
    const prompt = buildSummaryPrompt(state);

    // alpha sum = -0.1 + -0.05 + 0.4 + -0.2 = 0.05
    // beta sum  = 0.2 + 0.5 = 0.70
    // gamma sum = 0.3 + -0.1 = 0.20
    // Absolute order: beta (0.70) > gamma (0.20) > alpha (0.05)
    const betaIdx = prompt.indexOf("- beta:");
    const gammaIdx = prompt.indexOf("- gamma:");
    const alphaIdx = prompt.indexOf("- alpha:");
    expect(betaIdx).toBeGreaterThan(-1);
    expect(gammaIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(betaIdx).toBeLessThan(gammaIdx);
    expect(gammaIdx).toBeLessThan(alphaIdx);
    // Signs formatted with explicit + for non-negative totals.
    expect(prompt).toContain("+0.70");
    expect(prompt).toContain("+0.20");
    expect(prompt).toContain("+0.05");
  });

  test("empty rounds still produces a valid prompt", () => {
    const state: SimulationState = {
      ...makeCompleteState(),
      rounds: [],
    };
    const prompt = buildSummaryPrompt(state);

    expect(prompt).toContain("Rounds: 0");
    expect(prompt).toContain("(no drift recorded)");
  });
});

describe("summarizeSimulation", () => {
  test("invokes provider with system + user messages and returns concatenated output", async () => {
    const state = makeCompleteState();
    const provider = new MockProvider("## Input\n\nHello summary.");
    const result = await summarizeSimulation(state, provider);

    expect(result).toBe("## Input\n\nHello summary.");
    expect(provider.captured).toHaveLength(2);
    expect(provider.captured[0]?.role).toBe("system");
    expect(provider.captured[0]?.content).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(provider.captured[1]?.role).toBe("user");
    expect(provider.captured[1]?.content).toContain("sim-test-complete");
  });

  test("trims trailing whitespace from provider output", async () => {
    const state = makeCompleteState();
    const provider = new MockProvider("  hello\n\n  ");
    const result = await summarizeSimulation(state, provider);

    expect(result).toBe("hello");
  });

  test("passes through model option when supplied", async () => {
    const state = makeCompleteState();
    let capturedModel: string | undefined;
    const provider: LLMProvider = {
      kind: "openrouter",
      id: "model-probe",
      async *chat(_messages, options) {
        capturedModel = (options as { model?: string } | undefined)?.model;
        yield "ok";
      },
    };
    await summarizeSimulation(state, provider, { model: "some-model-id" });
    expect(capturedModel).toBe("some-model-id");
  });
});
