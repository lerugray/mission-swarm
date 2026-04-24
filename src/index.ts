// MissionSwarm CLI entry point (ms-006).
//
// Wires argument parsing → audience loader → persona generator → round
// loop. Persists state.json per round. Streams reaction JSON lines to
// stdout.
//
// Subcommands:
//   run              Run a full simulation end-to-end.
//   list-audiences   Show registered audience profiles.
//   help             Show usage.
//
// Configuration via environment:
//   OPENROUTER_API_KEY         Cloud LLM provider (preferred for sims).
//   OLLAMA_BASE_URL            Local LLM provider (fallback).
//   MISSIONSWARM_LLM_MODEL     Model id (e.g. anthropic/claude-sonnet-4-6).
//   MISSIONSWARM_SIMS_DIR      Override simulations output dir (default: ./simulations).
//
// --dry-run uses an in-process mock provider — canned persona + reaction
// responses — so end-to-end wiring can be tested without burning tokens
// or needing a live provider.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { generatePersonas } from "./personas";
import { resolveProvider } from "./providers/registry";
import type { LLMProvider, ChatMessage, ChatOptions } from "./providers/types";
import { runSimulation } from "./simulation";
import type { AudienceProfile, SimulationState } from "./types";

const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_AUDIENCES_DIR = join(REPO_ROOT, "audiences");
const DEFAULT_SIMS_DIR =
  process.env.MISSIONSWARM_SIMS_DIR ?? join(REPO_ROOT, "simulations");

// ─────────────────────────────────────────────────────────────
// Usage + main dispatcher
// ─────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`MissionSwarm — swarm-reaction simulation engine

Usage:
  missionswarm run [flags]        Run a full simulation
  missionswarm list-audiences     Show available audience profiles
  missionswarm help               Show this message

Flags for 'run':
  --input=<path-or-text>          Input document: file path OR inline text.
                                  Paths tried first; if not a file, treated as text.
                                  REQUIRED.
  --audience=<id>                 Audience profile id (see list-audiences).
                                  REQUIRED.
  --agents=<n>                    Number of personas to generate. Default: 12.
  --rounds=<n>                    Number of reaction rounds. Default: 5.
  --model=<id>                    Override MISSIONSWARM_LLM_MODEL for this run.
  --output=<dir>                  Override simulations output directory
                                  (default: ./simulations or
                                  MISSIONSWARM_SIMS_DIR).
  --feed-window=<n>               Rounds of prior feed each persona sees. Default: 3.
  --dry-run                       Use a canned-response mock provider. No LLM calls.
  --simulation-id=<id>            Override generated simulation id (advanced).

Environment:
  OPENROUTER_API_KEY              Cloud LLM provider (default preference).
  OLLAMA_BASE_URL                 Local LLM provider (fallback).
  MISSIONSWARM_LLM_MODEL          Model id (required for OpenRouter).
  MISSIONSWARM_SIMS_DIR           Simulations output directory.

Output:
  Per-simulation directory at <sims-dir>/<simulation-id>/ containing
  state.json. Reactions stream to stdout as JSON lines while the loop
  runs; full state is persisted atomically after each round.`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  switch (sub) {
    case "run":
      return runCmd(rest);
    case "list-audiences":
      return listAudiencesCmd();
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      return 0;
    default:
      console.error(`Unknown subcommand: ${sub}`);
      printUsage();
      return 1;
  }
}

// ─────────────────────────────────────────────────────────────
// `run`
// ─────────────────────────────────────────────────────────────

interface RunFlags {
  input?: string;
  audience?: string;
  agents: number;
  rounds: number;
  model?: string;
  output?: string;
  feedWindow: number;
  dryRun: boolean;
  simulationId?: string;
}

function parseRunFlags(argv: string[]): RunFlags {
  const f: RunFlags = {
    agents: 12,
    rounds: 5,
    feedWindow: 3,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") { f.dryRun = true; continue; }
    const eq = arg.indexOf("=");
    if (!arg.startsWith("--") || eq < 0) {
      console.error(`Unknown or malformed flag: ${arg}`);
      continue;
    }
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case "input": f.input = val; break;
      case "audience": f.audience = val; break;
      case "agents": f.agents = Math.max(1, parseInt(val, 10) || 0); break;
      case "rounds": f.rounds = Math.max(1, parseInt(val, 10) || 0); break;
      case "model": f.model = val; break;
      case "output": f.output = val; break;
      case "feed-window": f.feedWindow = Math.max(1, parseInt(val, 10) || 0); break;
      case "simulation-id": f.simulationId = val; break;
      default:
        console.error(`Unknown flag: --${key}`);
    }
  }
  return f;
}

async function runCmd(argv: string[]): Promise<number> {
  const flags = parseRunFlags(argv);
  if (!flags.input) {
    console.error("run: --input is required");
    return 2;
  }
  if (!flags.audience) {
    console.error("run: --audience is required");
    return 2;
  }

  const inputText = await resolveInputText(flags.input);
  const audience = await loadAudience(flags.audience);
  const provider = flags.dryRun
    ? createDryRunProvider()
    : resolveProvider(flags.model ? { modelOverride: flags.model } : {});
  const simulationsDir = flags.output ?? DEFAULT_SIMS_DIR;
  const simulationId = flags.simulationId ?? generateSimulationId();

  process.stderr.write(
    `[missionswarm] starting sim ${simulationId} · audience=${audience.id} · ` +
      `agents=${flags.agents} · rounds=${flags.rounds} · ` +
      `provider=${provider.kind}${flags.dryRun ? " (dry-run)" : ""}\n`,
  );

  const personas = await generatePersonas({
    simulationId,
    audience,
    inputDoc: inputText,
    nAgents: flags.agents,
    provider,
  });

  process.stderr.write(
    `[missionswarm] personas generated (${personas.length}) · starting rounds\n`,
  );

  const config = {
    input_doc: flags.input,
    audience_profile_id: audience.id,
    n_agents: flags.agents,
    n_rounds: flags.rounds,
    ...(flags.model ? { llm_model: flags.model } : {}),
  };
  const baseState: SimulationState = {
    id: simulationId,
    config,
    audience,
    resolved_input_doc: inputText,
    personas,
    rounds: [],
    status: "pending",
    started_at: new Date().toISOString(),
  };

  const final = await runSimulation({
    state: baseState,
    provider,
    simulationsDir,
    feedWindowRounds: flags.feedWindow,
  });

  process.stderr.write(
    `[missionswarm] ${final.status} · ${final.rounds.length}/${flags.rounds} rounds · ` +
      `state: ${join(simulationsDir, simulationId, "state.json")}\n`,
  );

  return final.status === "failed" ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────
// `list-audiences`
// ─────────────────────────────────────────────────────────────

async function listAudiencesCmd(): Promise<number> {
  const dir = DEFAULT_AUDIENCES_DIR;
  if (!existsSync(dir)) {
    console.error(`No audiences directory at ${dir}`);
    return 1;
  }
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir);
  const profiles: AudienceProfile[] = [];
  for (const e of entries) {
    if (!e.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, e), "utf8");
      const p = JSON.parse(raw) as AudienceProfile;
      if (p.id && p.name) profiles.push(p);
    } catch {
      // skip malformed
    }
  }
  if (profiles.length === 0) {
    console.log("No audience profiles found.");
    return 0;
  }
  console.log("Available audience profiles:\n");
  for (const p of profiles) {
    console.log(`  ${p.id.padEnd(24)}  ${p.name}`);
    console.log(`    ${p.description}`);
    console.log();
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function resolveInputText(inputArg: string): Promise<string> {
  if (existsSync(inputArg)) {
    return readFile(inputArg, "utf8");
  }
  return inputArg;
}

async function loadAudience(id: string): Promise<AudienceProfile> {
  const path = join(DEFAULT_AUDIENCES_DIR, `${id}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Audience profile '${id}' not found at ${path}. Run 'missionswarm list-audiences' to see available profiles.`,
    );
  }
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as AudienceProfile;
  if (!parsed.id || !parsed.name || !parsed.persona_template_guidance) {
    throw new Error(
      `Audience profile at ${path} is missing required fields (id, name, persona_template_guidance)`,
    );
  }
  return parsed;
}

function generateSimulationId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sim-${stamp}-${rand}`;
}

// ─────────────────────────────────────────────────────────────
// Dry-run provider: canned persona + reaction responses.
// Keeps end-to-end wiring testable without LLM access.
// ─────────────────────────────────────────────────────────────

function createDryRunProvider(): LLMProvider {
  let callN = 0;
  return {
    kind: "openrouter",
    id: "dry-run",
    async *chat(
      messages: ChatMessage[],
      _options?: ChatOptions,
    ): AsyncIterable<string> {
      callN++;
      // Heuristic: the personas prompt asks for "a JSON array",
      // reactions ask for a single object. Check the user message
      // to tell them apart.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const asksForArray = /as a JSON array|Generate \d+ personas/i.test(
        lastUser?.content ?? "",
      );
      if (asksForArray) {
        const n = parseN(lastUser?.content ?? "", /Generate\s+(\d+)\s+personas/i) ?? 3;
        yield JSON.stringify(cannedPersonas(n));
      } else {
        yield JSON.stringify(cannedReaction(callN));
      }
    },
  };
}

function parseN(s: string, re: RegExp): number | null {
  const m = s.match(re);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function cannedPersonas(n: number): unknown[] {
  const archetypes = [
    {
      name: "Col. Irina Volkov",
      bio: "Retired military analyst, clipped register.",
      stance: { escalation_risk: 0.3 },
      interest: { escalation_risk: 0.9 },
      style_markers: ["clipped military register"],
    },
    {
      name: "Jamal Okafor",
      bio: "Foreign-policy reporter, institutionalist.",
      stance: { alliance_cohesion: 0.6 },
      interest: { alliance_cohesion: 0.8 },
      style_markers: ["cites treaty history"],
    },
    {
      name: "Lena Park",
      bio: "Progressive activist, anti-interventionist.",
      stance: { civilian_harm: -0.7 },
      interest: { civilian_harm: 0.95 },
      style_markers: ["frames in colonial lens"],
    },
    {
      name: "Sen. Tom Hale",
      bio: "Conservative hawk, Cold War priors.",
      stance: { deterrence: 0.7 },
      interest: { deterrence: 0.9 },
      style_markers: ["invokes Reagan"],
    },
  ];
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const a = archetypes[i % archetypes.length]!;
    out.push({ ...a, name: `${a.name} #${i + 1}` });
  }
  return out;
}

function cannedReaction(seed: number): unknown {
  const spinner = ["advance", "retreat", "regroup", "consolidate", "drift"][seed % 5];
  return {
    text: `Dry-run reaction #${seed}: the situation continues to ${spinner}. We will see.`,
    stance_delta: { escalation_risk: ((seed % 7) - 3) / 20 },
    interest_delta: {},
  };
}

// ─────────────────────────────────────────────────────────────
// Kick off
// ─────────────────────────────────────────────────────────────

process.exit(await main());
