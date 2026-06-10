// MissionSwarm — talk subcommand tests (v-next).
//
// Covers persona resolution (id / case-insensitive name / miss),
// context reconstruction (own reactions as assistant turns; system
// prompt reuses reaction framing + releases the JSON format), the
// readline chat loop end-to-end against the dry-run provider with
// injected streams, and a full CLI subprocess dry-run.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { REACTION_SYSTEM_PROMPT } from "../src/simulation";
import {
  buildFeedDigest,
  buildTalkMessages,
  buildTalkSystemPrompt,
  createDryRunTalkProvider,
  nextTranscriptPath,
  resolvePersona,
  runTalkSession,
} from "../src/talk";
import type { Persona, SimulationState } from "../src/types";

const REPO_ROOT = join(import.meta.dir, "..");

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makePersona(i: number, simId: string, name?: string): Persona {
  return {
    id: `${simId}-${i}`,
    name: name ?? `P${i}`,
    bio: `persona ${i} bio`,
    stance: { topicA: 0.2 * i },
    interest: { topicA: 0.5 },
    style_markers: [`style-${i}`],
  };
}

function makeCompletedState(simId = "sim-talk-test"): SimulationState {
  const personas = [
    makePersona(0, simId, "Col. Irina Volkov"),
    makePersona(1, simId, "Jamal Okafor"),
  ];
  return {
    id: simId,
    config: {
      input_doc: "doc",
      audience_profile_id: "test",
      n_agents: 2,
      n_rounds: 2,
    },
    audience: {
      id: "test",
      name: "Test audience",
      description: "test",
      persona_template_guidance: "test",
    },
    resolved_input_doc: "The fleet sailed at dawn.",
    personas,
    rounds: [
      {
        number: 1,
        reactions: [
          {
            round_n: 1,
            persona_id: `${simId}-0`,
            text: "Volkov reaction round one.",
            stance_delta: {},
            interest_delta: {},
          },
          {
            round_n: 1,
            persona_id: `${simId}-1`,
            text: "Okafor reaction round one.",
            stance_delta: {},
            interest_delta: {},
          },
        ],
        started_at: "2026-06-10T00:00:00.000Z",
        completed_at: "2026-06-10T00:00:01.000Z",
      },
      {
        number: 2,
        reactions: [
          {
            round_n: 2,
            persona_id: `${simId}-0`,
            text: "Volkov reaction round two.",
            stance_delta: {},
            interest_delta: {},
          },
        ],
        started_at: "2026-06-10T00:01:00.000Z",
        completed_at: "2026-06-10T00:01:01.000Z",
      },
    ],
    status: "complete",
    started_at: "2026-06-10T00:00:00.000Z",
    completed_at: "2026-06-10T00:02:00.000Z",
  };
}

function collectorStream(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { stream, chunks };
}

// ─────────────────────────────────────────────────────────────
// Persona resolution
// ─────────────────────────────────────────────────────────────

describe("resolvePersona", () => {
  const state = makeCompletedState();

  test("matches by exact id", () => {
    const r = resolvePersona(state.personas, "sim-talk-test-1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona.name).toBe("Jamal Okafor");
  });

  test("matches by case-insensitive name", () => {
    const r = resolvePersona(state.personas, "col. irina VOLKOV");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona.id).toBe("sim-talk-test-0");
  });

  test("miss returns the available persona list", () => {
    const r = resolvePersona(state.personas, "Nobody Real");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.available.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Context reconstruction
// ─────────────────────────────────────────────────────────────

describe("buildTalkMessages", () => {
  const state = makeCompletedState();
  const volkov = state.personas[0]!;

  test("own prior reactions are injected as assistant turns, in order", () => {
    const messages = buildTalkMessages(state, volkov);
    const assistant = messages.filter((m) => m.role === "assistant");
    expect(assistant.map((m) => m.content)).toEqual([
      "Volkov reaction round one.",
      "Volkov reaction round two.",
    ]);
    // The other persona's reactions must NOT appear as assistant turns.
    expect(
      assistant.some((m) => m.content.includes("Okafor")),
    ).toBe(false);
  });

  test("system prompt reuses reaction framing and releases the JSON format", () => {
    const messages = buildTalkMessages(state, volkov);
    expect(messages[0]!.role).toBe("system");
    const system = messages[0]!.content;
    expect(system).toContain(REACTION_SYSTEM_PROMPT);
    expect(system).toContain(`YOU ARE: ${volkov.name}`);
    expect(system).toContain(`BIO: ${volkov.bio}`);
    expect(system).toContain("conversationally; no JSON");
  });

  test("user context carries the document and a digest of the other voices", () => {
    const messages = buildTalkMessages(state, volkov);
    const user = messages.find((m) => m.role === "user")!;
    expect(user.content).toContain("The fleet sailed at dawn.");
    expect(user.content).toContain("Okafor reaction round one.");
    // Own reactions excluded from the digest (they're assistant turns).
    expect(user.content).not.toContain("Volkov reaction round one.");
  });

  test("buildTalkSystemPrompt = framing + identity + release clause", () => {
    const sys = buildTalkSystemPrompt(volkov);
    expect(sys.startsWith(REACTION_SYSTEM_PROMPT)).toBe(true);
    expect(sys).toContain("YOUR CURRENT STANCE:");
  });

  test("buildFeedDigest truncates long reactions", () => {
    const longState = makeCompletedState("sim-long");
    longState.rounds[0]!.reactions[1]!.text = "x".repeat(500);
    const digest = buildFeedDigest(longState, `sim-long-0`, 100);
    const line = digest
      .split("\n")
      .find((l) => l.includes("Jamal Okafor"))!;
    expect(line.length).toBeLessThan(130);
    expect(line.endsWith("…")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Chat loop — dry-run, injected streams
// ─────────────────────────────────────────────────────────────

describe("runTalkSession (dry-run loop)", () => {
  test("two exchanges + /quit; transcript written", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-talk-"));
    try {
      const state = makeCompletedState();
      const persona = state.personas[0]!;
      const transcriptPath = join(tmp, "talks", "volkov-1.md");
      const input = Readable.from([
        "hello colonel\n",
        "what worries you most?\n",
        "/quit\n",
      ]);
      const { stream: output, chunks } = collectorStream();

      const exchanges = await runTalkSession({
        state,
        persona,
        provider: createDryRunTalkProvider(),
        transcriptPath,
        input,
        output,
      });

      expect(exchanges).toBe(2);
      const printed = chunks.join("");
      expect(printed).toContain("(dry-run reply #1)");
      expect(printed).toContain("(dry-run reply #2)");

      const transcript = await readFile(transcriptPath, "utf8");
      expect(transcript).toContain("# Talk with Col. Irina Volkov");
      expect(transcript).toContain("hello colonel");
      expect(transcript).toContain("(dry-run reply #2)");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("EOF without /quit exits gracefully", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-talk-"));
    try {
      const state = makeCompletedState();
      const exchanges = await runTalkSession({
        state,
        persona: state.personas[1]!,
        provider: createDryRunTalkProvider(),
        transcriptPath: join(tmp, "talks", "okafor-1.md"),
        input: Readable.from(["one message\n"]),
        output: collectorStream().stream,
      });
      expect(exchanges).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("nextTranscriptPath", () => {
  test("allocates the first free -<n>.md slot", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-talk-"));
    try {
      const persona = makePersona(0, "sim-x", "Col. Irina Volkov");
      const first = nextTranscriptPath(tmp, persona);
      expect(first).toBe(join(tmp, "talks", "col-irina-volkov-1.md"));
      await mkdir(join(tmp, "talks"), { recursive: true });
      await writeFile(first, "occupied", "utf8");
      const second = nextTranscriptPath(tmp, persona);
      expect(second).toBe(join(tmp, "talks", "col-irina-volkov-2.md"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Full CLI subprocess — dry-run end-to-end
// ─────────────────────────────────────────────────────────────

describe("talk CLI (subprocess, --dry-run)", () => {
  test("exit 0, streams canned reply, writes transcript", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-talk-cli-"));
    try {
      const state = makeCompletedState("sim-talk-e2e");
      const simDir = join(tmp, "sim-talk-e2e");
      await mkdir(simDir, { recursive: true });
      await writeFile(join(simDir, "state.json"), JSON.stringify(state));

      const proc = Bun.spawn({
        cmd: [
          "bun",
          "src/index.ts",
          "talk",
          "sim-talk-e2e",
          "Col. Irina Volkov",
          "--sims-dir",
          tmp,
          "--dry-run",
        ],
        cwd: REPO_ROOT,
        stdin: Buffer.from("status report, colonel\n/quit\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(0);
      expect(stdout).toContain("(dry-run reply #1)");
      const transcriptPath = join(simDir, "talks", "col-irina-volkov-1.md");
      expect(existsSync(transcriptPath)).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("unknown persona lists available voices and exits 1", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ms-talk-cli-"));
    try {
      const state = makeCompletedState("sim-talk-miss");
      const simDir = join(tmp, "sim-talk-miss");
      await mkdir(simDir, { recursive: true });
      await writeFile(join(simDir, "state.json"), JSON.stringify(state));

      const proc = Bun.spawn({
        cmd: [
          "bun",
          "src/index.ts",
          "talk",
          "sim-talk-miss",
          "Nobody Real",
          "--sims-dir",
          tmp,
          "--dry-run",
        ],
        cwd: REPO_ROOT,
        stdin: Buffer.from(""),
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Col. Irina Volkov");
      expect(stderr).toContain("Jamal Okafor");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
