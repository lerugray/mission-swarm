// MissionSwarm — round-loop tests (ms-004 + ms-007 foundation)
//
// Exercises the simulation loop against a mock provider so the
// round-by-round state transitions, delta application, failure
// policy, and JSON-parse recovery can all be verified without
// burning real tokens. Live-LLM validation is a separate manual
// step.

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runSimulation,
  persistState,
  loadState,
  setReactionEmitter,
} from "../src/simulation";
import type {
  AudienceProfile,
  Persona,
  Reaction,
  SimulationState,
} from "../src/types";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "../src/providers/types";
import { ProviderTransportError } from "../src/providers/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const AUDIENCE: AudienceProfile = {
  id: "test",
  name: "Test audience",
  description: "test",
  persona_template_guidance: "test",
};

function seedPersonas(n: number, simId: string): Persona[] {
  const out: Persona[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${simId}-${i}`,
      name: `P${i}`,
      bio: `persona ${i}`,
      stance: { topicA: 0 },
      interest: { topicA: 0.5 },
      style_markers: [`style-${i}`],
    });
  }
  return out;
}

function baseState(nAgents: number, nRounds: number): SimulationState {
  const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    config: {
      input_doc: "test-doc",
      audience_profile_id: AUDIENCE.id,
      n_agents: nAgents,
      n_rounds: nRounds,
    },
    audience: AUDIENCE,
    resolved_input_doc: "A short test document.",
    personas: seedPersonas(nAgents, id),
    rounds: [],
    status: "pending",
    started_at: new Date().toISOString(),
  };
}

/** Provider that returns scripted responses in sequence. If the
 *  script runs out, throws — so tests fail loudly on unexpected
 *  extra calls. */
function scriptedProvider(script: (string | Error)[]): LLMProvider {
  let i = 0;
  return {
    kind: "openrouter",
    id: "mock",
    async *chat(
      _messages: ChatMessage[],
      _options?: ChatOptions,
    ): AsyncIterable<string> {
      const r = script[i++];
      if (r === undefined) {
        throw new Error(`script exhausted at call ${i}`);
      }
      if (r instanceof Error) throw r;
      yield r;
    },
  };
}

function reactionJson(
  text: string,
  stanceDelta: Record<string, number> = {},
  interestDelta: Record<string, number> = {},
): string {
  return JSON.stringify({
    text,
    stance_delta: stanceDelta,
    interest_delta: interestDelta,
  });
}

let tmp: string;
let emitted: Reaction[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "missionswarm-sim-"));
  emitted = [];
  setReactionEmitter((r) => emitted.push(r));
});

async function cleanup(): Promise<void> {
  await rm(tmp, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("runSimulation happy path", () => {
  test("2 rounds × 3 personas settles to complete with deltas applied", async () => {
    const state = baseState(3, 2);
    // Round 1 — each persona moves topicA stance by +0.2
    // Round 2 — each moves by −0.1 and adds interest on topicB
    const script: string[] = [];
    for (const roundDelta of [0.2, -0.1]) {
      for (let i = 0; i < 3; i++) {
        script.push(
          reactionJson(
            `persona ${i} says hello r${script.length}`,
            { topicA: roundDelta },
            roundDelta < 0 ? { topicB: 0.3 } : {},
          ),
        );
      }
    }
    const provider = scriptedProvider(script);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });

    expect(final.status).toBe("complete");
    expect(final.rounds.length).toBe(2);
    expect(final.rounds[0]!.reactions.length).toBe(3);
    expect(final.rounds[1]!.reactions.length).toBe(3);

    // Each persona should end round 2 with topicA = 0 + 0.2 − 0.1 = 0.1
    for (const p of final.personas) {
      expect(p.stance.topicA!).toBeCloseTo(0.1, 5);
      expect(p.interest.topicB!).toBeCloseTo(0.3, 5);
    }

    // Emitter should have seen 6 reactions
    expect(emitted.length).toBe(6);

    // State should be on disk
    const loaded = await loadState(tmp, state.id);
    expect(loaded?.status).toBe("complete");
    expect(loaded?.rounds.length).toBe(2);

    await cleanup();
  });
});

describe("runSimulation failure policy", () => {
  test("one persona failing in a round does not abort the simulation", async () => {
    const state = baseState(3, 2);
    const script: (string | Error)[] = [
      reactionJson("ok p0 r1"),
      new ProviderTransportError("network down"),
      reactionJson("ok p2 r1"),
      reactionJson("ok p0 r2"),
      reactionJson("ok p1 r2"),
      reactionJson("ok p2 r2"),
    ];
    const provider = scriptedProvider(script);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });

    expect(final.status).toBe("complete");
    expect(final.rounds.length).toBe(2);
    expect(final.rounds[0]!.reactions.length).toBe(2); // one dropped
    expect(final.rounds[1]!.reactions.length).toBe(3);

    await cleanup();
  });

  test("all personas failing in a round aborts with status=failed", async () => {
    const state = baseState(2, 2);
    const script: (string | Error)[] = [
      new ProviderTransportError("down"),
      new ProviderTransportError("still down"),
    ];
    const provider = scriptedProvider(script);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });

    expect(final.status).toBe("failed");
    expect(final.rounds.length).toBe(0);
    expect(final.failure_reason).toMatch(/All 2 personas failed/);

    await cleanup();
  });
});

describe("runSimulation parse recovery", () => {
  test("code-fenced response still parses", async () => {
    const state = baseState(1, 1);
    const fenced = "```json\n" + reactionJson("fenced ok") + "\n```";
    const provider = scriptedProvider([fenced]);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });
    expect(final.status).toBe("complete");
    expect(final.rounds[0]!.reactions[0]!.text).toBe("fenced ok");
    await cleanup();
  });

  test("response with preamble + object still parses via extraction", async () => {
    const state = baseState(1, 1);
    const withPreamble = "Here is your reaction:\n" + reactionJson("chatty ok");
    const provider = scriptedProvider([withPreamble]);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });
    expect(final.status).toBe("complete");
    expect(final.rounds[0]!.reactions[0]!.text).toBe("chatty ok");
    await cleanup();
  });

  test("entirely malformed response is reported as a persona failure (not a throw)", async () => {
    const state = baseState(2, 1);
    const provider = scriptedProvider([
      "not json at all — sorry!",
      reactionJson("p1 ok"),
    ]);
    const final = await runSimulation({
      state,
      provider,
      simulationsDir: tmp,
    });
    expect(final.status).toBe("complete");
    expect(final.rounds[0]!.reactions.length).toBe(1);
    expect(final.rounds[0]!.reactions[0]!.persona_id.endsWith("-1")).toBe(true);
    await cleanup();
  });
});

describe("persistState round-trip", () => {
  test("state.json is deep-equal after write + read", async () => {
    const state = baseState(2, 1);
    state.rounds.push({
      number: 1,
      reactions: [
        {
          round_n: 1,
          persona_id: state.personas[0]!.id,
          text: "hi",
          stance_delta: { a: 0.1 },
          interest_delta: {},
        },
      ],
      started_at: "2026-04-24T00:00:00.000Z",
      completed_at: "2026-04-24T00:00:01.000Z",
    });
    state.status = "running";

    await persistState(tmp, state);
    const roundTripped = await loadState(tmp, state.id);
    expect(roundTripped).toEqual(state);

    await cleanup();
  });
});
