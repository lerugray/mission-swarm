// MissionSwarm — list-sims CLI helper tests
//
// Covers the row-extraction + table-formatting helpers that the
// `list-sims` subcommand uses. End-to-end CLI invocation is not
// exercised here (it spawns filesystem reads + stdout writes); the
// pure helpers carry the logic worth locking down.

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatSimRows, readSimRow } from "../src/index";
import type { SimulationState } from "../src/types";

function makeState(overrides: Partial<SimulationState> = {}): SimulationState {
  return {
    id: "sim-test-001",
    config: {
      input_doc: "test",
      audience_profile_id: "kriegspiel",
      n_agents: 6,
      n_rounds: 4,
    },
    audience: {
      id: "kriegspiel",
      name: "Kriegspiel",
      description: "test",
      persona_template_guidance: "test",
    },
    resolved_input_doc: "test",
    personas: Array.from({ length: 6 }, (_, i) => ({
      id: `sim-test-001-${i}`,
      name: `P${i}`,
      bio: `b${i}`,
      stance: {},
      interest: {},
      style_markers: [],
    })),
    rounds: Array.from({ length: 2 }, (_, i) => ({
      number: i + 1,
      reactions: [],
      started_at: "2026-04-24T12:00:00Z",
      completed_at: "2026-04-24T12:00:30Z",
    })),
    status: "complete",
    started_at: "2026-04-24T12:00:00Z",
    completed_at: "2026-04-24T12:02:00Z",
    ...overrides,
  };
}

describe("readSimRow", () => {
  test("returns populated row for a valid sim dir with summary.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-list-sims-"));
    const simDir = join(dir, "sim-001");
    await mkdir(simDir);
    await writeFile(join(simDir, "state.json"), JSON.stringify(makeState()));
    await writeFile(join(simDir, "summary.md"), "## Input\n\nabc");
    try {
      const row = await readSimRow(simDir, "sim-001");
      expect(row).not.toBeNull();
      expect(row!.id).toBe("sim-001");
      expect(row!.date).toBe("2026-04-24");
      expect(row!.audience).toBe("kriegspiel");
      expect(row!.agents).toBe(6);
      expect(row!.rounds).toBe(2);
      expect(row!.plannedRounds).toBe(4);
      expect(row!.status).toBe("complete");
      expect(row!.hasSummary).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("hasSummary=false when summary.md missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-list-sims-"));
    const simDir = join(dir, "sim-002");
    await mkdir(simDir);
    await writeFile(join(simDir, "state.json"), JSON.stringify(makeState()));
    try {
      const row = await readSimRow(simDir, "sim-002");
      expect(row).not.toBeNull();
      expect(row!.hasSummary).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null for dir with no state.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-list-sims-"));
    const simDir = join(dir, "empty");
    await mkdir(simDir);
    try {
      const row = await readSimRow(simDir, "empty");
      expect(row).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null for malformed state.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-list-sims-"));
    const simDir = join(dir, "bad");
    await mkdir(simDir);
    await writeFile(join(simDir, "state.json"), "not json");
    try {
      const row = await readSimRow(simDir, "bad");
      expect(row).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to id-based date when started_at is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-list-sims-"));
    const simDir = join(dir, "sim-2026-03-15-abc");
    await mkdir(simDir);
    const state = makeState({ started_at: "" });
    await writeFile(join(simDir, "state.json"), JSON.stringify(state));
    try {
      const row = await readSimRow(simDir, "sim-2026-03-15-abc");
      expect(row).not.toBeNull();
      expect(row!.date).toBe("2026-03-15");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatSimRows", () => {
  test("returns placeholder for empty input", () => {
    expect(formatSimRows([])).toBe("No simulations found.");
  });

  test("renders header + separator + rows", () => {
    const rows = [
      {
        id: "sim-alpha",
        date: "2026-04-24",
        audience: "kriegspiel",
        agents: 6,
        rounds: 2,
        plannedRounds: 2,
        status: "complete",
        hasSummary: true,
      },
      {
        id: "sim-beta",
        date: "2026-04-23",
        audience: "gaming-community",
        agents: 4,
        rounds: 1,
        plannedRounds: 1,
        status: "complete",
        hasSummary: false,
      },
    ];
    const out = formatSimRows(rows);
    expect(out).toContain("ID");
    expect(out).toContain("DATE");
    expect(out).toContain("AUDIENCE");
    expect(out).toContain("STATUS");
    expect(out).toContain("SUMMARY");
    expect(out).toContain("sim-alpha");
    expect(out).toContain("kriegspiel");
    expect(out).toContain("6p x 2/2r");
    expect(out).toContain("sim-beta");
    expect(out).toContain("gaming-community");
    expect(out).toContain("4p x 1/1r");
    // Separator row
    expect(out).toContain("----");
    // Summary column displays yes/no correctly
    const lines = out.split("\n");
    const alphaLine = lines.find((l) => l.includes("sim-alpha"));
    const betaLine = lines.find((l) => l.includes("sim-beta"));
    expect(alphaLine?.endsWith("yes")).toBe(true);
    expect(betaLine?.endsWith("no")).toBe(true);
  });
});
