// MissionSwarm — audience generator tests (ms-011)
//
// Mock-LLM driven; verifies parsing, retry, id-authority,
// length-floor validation, and exemplar inclusion in the prompt.
// Live-LLM voice validation is a separate manual step.

import { describe, expect, test } from "bun:test";
import {
  generateAudience,
  AudienceGenerationError,
} from "../src/audience-generator";
import type { AudienceProfile } from "../src/types";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "../src/providers/types";
import { ProviderTransportError } from "../src/providers/types";

// ─────────────────────────────────────────────────────────────
// Mock provider — records messages it saw + replays canned responses
// ─────────────────────────────────────────────────────────────

interface MockProvider extends LLMProvider {
  /** All `messages` arrays the provider has been called with so far. */
  calls: ChatMessage[][];
}

function mockProvider(responses: string[]): MockProvider {
  let callIdx = 0;
  const calls: ChatMessage[][] = [];
  const provider: MockProvider = {
    kind: "openrouter",
    id: "mock",
    calls,
    async *chat(
      messages: ChatMessage[],
      _options?: ChatOptions,
    ): AsyncIterable<string> {
      calls.push(messages);
      const r = responses[callIdx++];
      if (r === undefined) {
        throw new Error(
          `Mock provider exhausted — no response for call ${callIdx}`,
        );
      }
      yield r;
    },
  };
  return provider;
}

function failingProvider(error: Error): LLMProvider {
  return {
    kind: "openrouter",
    id: "mock-failing",
    async *chat(): AsyncIterable<string> {
      throw error;
      yield ""; // unreachable, satisfies AsyncIterable shape
    },
  };
}

const SAMPLE_EXEMPLAR: AudienceProfile = {
  id: "kriegspiel",
  name: "Kriegspiel — strategic-scenario reaction audience",
  description: "Strategic-scenario reaction audience.",
  persona_template_guidance: "Reference guidance text for kriegspiel exemplar.",
};

function longGuidance(prefix: string = ""): string {
  // Build a string >= 800 chars that the validator will accept.
  const body =
    "TEMPLATE GROUPS\n\n" +
    "1. Group A — concrete description block. ".repeat(8) +
    "\n2. Group B — concrete description block. ".repeat(8) +
    "\n3. Group C — concrete description block. ".repeat(8) +
    "\nCRAFT RULES\n\n" +
    "- Names should sound real. ".repeat(6) +
    "- Bios should carry concrete details. ".repeat(6) +
    "- Stances should vary meaningfully. ".repeat(6);
  return prefix + body;
}

function cannedAudienceJson(overrides: Partial<AudienceProfile> = {}): string {
  return JSON.stringify({
    id: overrides.id ?? "test-audience",
    name: overrides.name ?? "Test audience name",
    description: overrides.description ?? "A description of the test audience.",
    persona_template_guidance:
      overrides.persona_template_guidance ?? longGuidance(),
  });
}

// ─────────────────────────────────────────────────────────────
// Happy path + id authority
// ─────────────────────────────────────────────────────────────

describe("generateAudience", () => {
  test("parses valid JSON and returns an AudienceProfile", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    const result = await generateAudience({
      id: "policy-analyst",
      description: "DC commentariat watching Indo-Pacific policy.",
      exemplars: [SAMPLE_EXEMPLAR],
      provider,
    });

    expect(result.id).toBe("policy-analyst");
    expect(result.name).toBe("Test audience name");
    expect(result.persona_template_guidance.length).toBeGreaterThanOrEqual(800);
    expect(provider.calls.length).toBe(1);
  });

  test("forces user-provided id even when LLM emits a different id", async () => {
    const provider = mockProvider([
      cannedAudienceJson({ id: "different-id" }),
    ]);

    const result = await generateAudience({
      id: "policy-analyst",
      description: "DC commentariat watching Indo-Pacific policy.",
      exemplars: [SAMPLE_EXEMPLAR],
      provider,
    });

    expect(result.id).toBe("policy-analyst");
  });

  test("falls back to user description when LLM omits one", async () => {
    const provider = mockProvider([
      JSON.stringify({
        name: "X",
        persona_template_guidance: longGuidance(),
      }),
    ]);

    const result = await generateAudience({
      id: "x",
      description: "User-supplied description.",
      exemplars: [],
      provider,
    });

    expect(result.description).toBe("User-supplied description.");
  });

  test("includes exemplars verbatim in the prompt", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    await generateAudience({
      id: "x",
      description: "test",
      exemplars: [SAMPLE_EXEMPLAR],
      provider,
    });

    const userMsg = provider.calls[0]!.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("REFERENCE EXAMPLES");
    expect(userMsg).toContain("audience: kriegspiel");
    expect(userMsg).toContain("Reference guidance text for kriegspiel exemplar.");
  });

  test("works with zero exemplars (no REFERENCE EXAMPLES block)", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    const result = await generateAudience({
      id: "x",
      description: "test",
      exemplars: [],
      provider,
    });

    expect(result.id).toBe("x");
    const userMsg = provider.calls[0]!.find((m) => m.role === "user")!.content;
    expect(userMsg).not.toContain("REFERENCE EXAMPLES");
  });

  test("threads nGroups into the prompt", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    await generateAudience({
      id: "x",
      description: "test",
      nGroups: 6,
      exemplars: [],
      provider,
    });

    const sysMsg = provider.calls[0]!.find((m) => m.role === "system")!.content;
    const userMsg = provider.calls[0]!.find((m) => m.role === "user")!.content;
    expect(sysMsg).toContain("6 template groups");
    expect(userMsg).toContain("target template groups: 6");
  });
});

// ─────────────────────────────────────────────────────────────
// Parse-recovery
// ─────────────────────────────────────────────────────────────

describe("generateAudience — parse recovery", () => {
  test("strips markdown code fence", async () => {
    const provider = mockProvider([
      "```json\n" + cannedAudienceJson() + "\n```",
    ]);

    const result = await generateAudience({
      id: "x",
      description: "test",
      exemplars: [],
      provider,
    });

    expect(result.id).toBe("x");
  });

  test("recovers from preamble + trailing prose", async () => {
    const provider = mockProvider([
      "Sure! Here is your audience:\n\n" +
        cannedAudienceJson() +
        "\n\nLet me know if you'd like adjustments.",
    ]);

    const result = await generateAudience({
      id: "x",
      description: "test",
      exemplars: [],
      provider,
    });

    expect(result.id).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────
// Retry behaviour
// ─────────────────────────────────────────────────────────────

describe("generateAudience — retry", () => {
  test("retries once on malformed JSON, then succeeds", async () => {
    const provider = mockProvider([
      "not json at all",
      cannedAudienceJson(),
    ]);

    const result = await generateAudience({
      id: "x",
      description: "test",
      exemplars: [],
      provider,
    });

    expect(result.id).toBe("x");
    expect(provider.calls.length).toBe(2);
  });

  test("retries once on too-short guidance, then succeeds", async () => {
    const provider = mockProvider([
      JSON.stringify({
        id: "x",
        name: "x",
        description: "x",
        persona_template_guidance: "way too short",
      }),
      cannedAudienceJson(),
    ]);

    const result = await generateAudience({
      id: "x",
      description: "test",
      exemplars: [],
      provider,
    });

    expect(result.id).toBe("x");
    expect(provider.calls.length).toBe(2);
  });

  test("throws AudienceGenerationError after retry exhaustion", async () => {
    const provider = mockProvider([
      "not json",
      "still not json",
    ]);

    await expect(
      generateAudience({
        id: "x",
        description: "test",
        exemplars: [],
        provider,
      }),
    ).rejects.toThrow(AudienceGenerationError);
    expect(provider.calls.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Provider error wrapping + input validation
// ─────────────────────────────────────────────────────────────

describe("generateAudience — error wrapping + input validation", () => {
  test("wraps ProviderError as AudienceGenerationError", async () => {
    const provider = failingProvider(
      new ProviderTransportError("connection refused"),
    );

    await expect(
      generateAudience({
        id: "x",
        description: "test",
        exemplars: [],
        provider,
      }),
    ).rejects.toThrow(AudienceGenerationError);
  });

  test("rejects empty id", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    await expect(
      generateAudience({
        id: "",
        description: "test",
        exemplars: [],
        provider,
      }),
    ).rejects.toThrow(AudienceGenerationError);
  });

  test("rejects empty description", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    await expect(
      generateAudience({
        id: "x",
        description: "",
        exemplars: [],
        provider,
      }),
    ).rejects.toThrow(AudienceGenerationError);
  });

  test("rejects nGroups < 1", async () => {
    const provider = mockProvider([cannedAudienceJson()]);

    await expect(
      generateAudience({
        id: "x",
        description: "test",
        nGroups: 0,
        exemplars: [],
        provider,
      }),
    ).rejects.toThrow(AudienceGenerationError);
  });
});
