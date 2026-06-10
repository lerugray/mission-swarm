// MissionSwarm — council subcommand tests (v-next).
//
// Covers the audience-xor-from-sim CLI gate, the locked three-section
// synthesis prompt, failed-voice exclusion (never fabricated over),
// the <2-successes synthesis skip, the from-sim persona cap, and the
// dry-run end-to-end paths for both persona sources.

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COUNCIL_AGREE_LABEL,
  COUNCIL_BOTTOM_LINE_LABEL,
  COUNCIL_DIFFER_LABEL,
  buildCouncilTakeMessages,
  buildSynthesisMessages,
  createDryRunCouncilTakeProvider,
  createDryRunSynthesisProvider,
  runCouncil,
  type CouncilRecord,
} from "../src/council";
import { councilCmd } from "../src/index";
import type {
  ChatMessage,
  ChatOptions,
  LLMProvider,
} from "../src/providers/types";
import { ProviderTransportError } from "../src/providers/types";
import type { Persona, SimulationState } from "../src/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makePersona(i: number, simId: string, name?: string): Persona {
  return {
    id: `${simId}-${i}`,
    name: name ?? `Persona ${i}`,
    bio: `bio ${i}`,
    stance: { topicA: 0.1 * i },
    interest: { topicA: 0.5 },
    style_markers: [`style-${i}`],
  };
}

function makeCompletedState(
  simId: string,
  nPersonas: number,
): SimulationState {
  return {
    id: simId,
    config: {
      input_doc: "doc",
      audience_profile_id: "test",
      n_agents: nPersonas,
      n_rounds: 1,
    },
    audience: {
      id: "test",
      name: "Test audience",
      description: "test",
      persona_template_guidance: "test",
    },
    resolved_input_doc: "The bridge was demolished overnight.",
    personas: Array.from({ length: nPersonas }, (_, i) =>
      makePersona(i, simId),
    ),
    rounds: [
      {
        number: 1,
        reactions: [],
        started_at: "2026-06-10T00:00:00.000Z",
        completed_at: "2026-06-10T00:00:01.000Z",
      },
    ],
    status: "complete",
    started_at: "2026-06-10T00:00:00.000Z",
    completed_at: "2026-06-10T00:01:00.000Z",
  };
}

async function writeSim(
  simsDir: string,
  state: SimulationState,
): Promise<void> {
  const dir = join(simsDir, state.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "state.json"), JSON.stringify(state));
}

/** Take provider that fails for the named personas, answers otherwise. */
function takeProviderFailingFor(failNames: string[]): LLMProvider {
  return {
    kind: "openrouter",
    id: "mock-takes",
    async *chat(messages: ChatMessage[]): AsyncIterable<string> {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const m = system.match(/YOU ARE: (.+)/);
      const name = m?.[1] ?? "";
      if (failNames.includes(name)) {
        throw new ProviderTransportError(`voice ${name} down`);
      }
      yield `${name} answers: hold the line.`;
    },
  };
}

/** Synthesis provider that records the messages it was called with. */
function recordingSynthesisProvider(): {
  provider: LLMProvider;
  calls: ChatMessage[][];
} {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    provider: {
      kind: "openrouter",
      id: "mock-synthesis",
      async *chat(
        messages: ChatMessage[],
        _options?: ChatOptions,
      ): AsyncIterable<string> {
        calls.push(messages);
        yield "synthesized.";
      },
    },
  };
}

async function findCouncilDir(simsDir: string): Promise<string> {
  const entries = await readdir(simsDir);
  const hit = entries.find((e) => e.startsWith("council-"));
  expect(hit).toBeDefined();
  return join(simsDir, hit!);
}

// ─────────────────────────────────────────────────────────────
// CLI gate: audience XOR from-sim
// ─────────────────────────────────────────────────────────────

describe("councilCmd argument gate", () => {
  test("neither --audience nor --from-sim → exit 2", async () => {
    expect(await councilCmd(["a question", "--dry-run"])).toBe(2);
  });

  test("both --audience and --from-sim → exit 2", async () => {
    expect(
      await councilCmd([
        "a question",
        "--audience",
        "kriegspiel",
        "--from-sim",
        "sim-x",
        "--dry-run",
      ]),
    ).toBe(2);
  });

  test("missing question → exit 2", async () => {
    expect(
      await councilCmd(["--audience", "kriegspiel", "--dry-run"]),
    ).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Synthesis prompt — locked three-section shape
// ─────────────────────────────────────────────────────────────

describe("buildSynthesisMessages", () => {
  test("system prompt carries the three exact section labels", () => {
    const takes = [
      { persona_id: "a-0", persona_name: "Alpha", text: "yes" },
      { persona_id: "a-1", persona_name: "Beta", text: "no" },
    ];
    const messages = buildSynthesisMessages("should we?", takes);
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("## Where they agree");
    expect(system).toContain("## Where they differ");
    expect(system).toContain("## Bottom line");
    // Constants stay in lockstep with the literals.
    expect(COUNCIL_AGREE_LABEL).toBe("Where they agree");
    expect(COUNCIL_DIFFER_LABEL).toBe("Where they differ");
    expect(COUNCIL_BOTTOM_LINE_LABEL).toBe("Bottom line");
  });

  test("user body carries question + every take attributed by name", () => {
    const takes = [
      { persona_id: "a-0", persona_name: "Alpha", text: "yes, decisively" },
      { persona_id: "a-1", persona_name: "Beta", text: "no, never" },
    ];
    const messages = buildSynthesisMessages("should we?", takes);
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("should we?");
    expect(user).toContain("### Alpha");
    expect(user).toContain("yes, decisively");
    expect(user).toContain("### Beta");
  });
});

describe("buildCouncilTakeMessages", () => {
  test("independent-voice framing: no awareness of other answers, no JSON", () => {
    const p = makePersona(0, "sim-c", "Gamma");
    const messages = buildCouncilTakeMessages(p, "what now?");
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("NOT seen any other council member's answer");
    expect(system).toContain("YOU ARE: Gamma");
    expect(system).toContain("no JSON");
  });

  test("from-sim document context lands in the user turn when provided", () => {
    const p = makePersona(0, "sim-c", "Gamma");
    const withDoc = buildCouncilTakeMessages(p, "what now?", "THE DOC");
    expect(withDoc.find((m) => m.role === "user")!.content).toContain(
      "THE DOC",
    );
    const without = buildCouncilTakeMessages(p, "what now?");
    expect(without.find((m) => m.role === "user")!.content).not.toContain(
      "THE DOC",
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Failure policy
// ─────────────────────────────────────────────────────────────

describe("runCouncil failure policy", () => {
  const personas = [
    makePersona(0, "sim-f", "Alpha"),
    makePersona(1, "sim-f", "Beta"),
    makePersona(2, "sim-f", "Gamma"),
  ];

  test("failed voices are excluded from synthesis, never fabricated over", async () => {
    const { provider: synthesisProvider, calls } =
      recordingSynthesisProvider();
    const result = await runCouncil({
      personas,
      question: "advance or hold?",
      takeProvider: takeProviderFailingFor(["Beta"]),
      synthesisProvider,
    });

    expect(result.takes.map((t) => t.persona_name)).toEqual([
      "Alpha",
      "Gamma",
    ]);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]!.persona_name).toBe("Beta");
    expect(result.synthesis).toBe("synthesized.");

    // The synthesis call never saw the failed voice.
    expect(calls.length).toBe(1);
    const synthesisUser = calls[0]!.find((m) => m.role === "user")!.content;
    expect(synthesisUser).toContain("### Alpha");
    expect(synthesisUser).toContain("### Gamma");
    expect(synthesisUser).not.toContain("Beta");
    expect(synthesisUser).toContain("2 voices");
  });

  test("fewer than 2 successes → synthesis skipped with note", async () => {
    const { provider: synthesisProvider, calls } =
      recordingSynthesisProvider();
    const result = await runCouncil({
      personas,
      question: "advance or hold?",
      takeProvider: takeProviderFailingFor(["Alpha", "Gamma"]),
      synthesisProvider,
    });
    expect(result.takes.length).toBe(1);
    expect(result.failures.length).toBe(2);
    expect(result.synthesis).toBeNull();
    expect(result.note).toContain("Synthesis skipped");
    expect(calls.length).toBe(0); // synthesis never called
  });
});

// ─────────────────────────────────────────────────────────────
// Dry-run end-to-end — both persona sources
// ─────────────────────────────────────────────────────────────

describe("councilCmd --from-sim (dry-run end-to-end)", () => {
  test("persists council.json + council.md with three-section synthesis", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-council-"));
    try {
      await writeSim(tmp, makeCompletedState("sim-council-src", 3));
      const code = await councilCmd([
        "What do you make of the demolition?",
        "--from-sim",
        "sim-council-src",
        "--sims-dir",
        tmp,
        "--dry-run",
      ]);
      expect(code).toBe(0);

      const dir = await findCouncilDir(tmp);
      const record = JSON.parse(
        await readFile(join(dir, "council.json"), "utf8"),
      ) as CouncilRecord;
      expect(record.question).toBe("What do you make of the demolition?");
      expect(record.source.kind).toBe("from-sim");
      expect(record.takes.length).toBe(3);
      expect(record.failures.length).toBe(0);
      expect(record.synthesis).toContain("## Where they agree");
      expect(record.synthesis).toContain("## Where they differ");
      expect(record.synthesis).toContain("## Bottom line");

      const md = await readFile(join(dir, "council.md"), "utf8");
      expect(md).toContain("## Takes");
      expect(md).toContain("## Synthesis");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("evolved-persona selection caps at 8", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-council-"));
    try {
      await writeSim(tmp, makeCompletedState("sim-council-big", 12));
      const code = await councilCmd([
        "Too many voices?",
        "--from-sim",
        "sim-council-big",
        "--sims-dir",
        tmp,
        "--dry-run",
      ]);
      expect(code).toBe(0);
      const dir = await findCouncilDir(tmp);
      const record = JSON.parse(
        await readFile(join(dir, "council.json"), "utf8"),
      ) as CouncilRecord;
      expect(record.takes.length).toBe(8);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("councilCmd --audience (dry-run end-to-end)", () => {
  test("generates fresh personas from a shipped profile and synthesizes", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-council-"));
    try {
      const code = await councilCmd([
        "How does this audience read a surprise announcement?",
        "--audience",
        "kriegspiel",
        "--personas",
        "3",
        "--sims-dir",
        tmp,
        "--dry-run",
      ]);
      expect(code).toBe(0);
      const dir = await findCouncilDir(tmp);
      const record = JSON.parse(
        await readFile(join(dir, "council.json"), "utf8"),
      ) as CouncilRecord;
      expect(record.source.kind).toBe("audience");
      if (record.source.kind === "audience") {
        expect(record.source.audience_id).toBe("kriegspiel");
      }
      expect(record.takes.length).toBe(3);
      expect(record.synthesis).toContain("## Bottom line");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Dry-run provider sanity
// ─────────────────────────────────────────────────────────────

describe("dry-run council providers", () => {
  test("take provider stays in persona voice (names the persona)", async () => {
    const p = makePersona(0, "sim-d", "Col. Irina Volkov");
    const provider = createDryRunCouncilTakeProvider();
    let out = "";
    for await (const c of provider.chat(
      buildCouncilTakeMessages(p, "q?"),
    )) {
      out += c;
    }
    expect(out).toContain("Col. Irina Volkov");
  });

  test("synthesis provider emits the locked three sections", async () => {
    const provider = createDryRunSynthesisProvider();
    let out = "";
    for await (const c of provider.chat([])) out += c;
    expect(out).toContain(`## ${COUNCIL_AGREE_LABEL}`);
    expect(out).toContain(`## ${COUNCIL_DIFFER_LABEL}`);
    expect(out).toContain(`## ${COUNCIL_BOTTOM_LINE_LABEL}`);
  });
});
