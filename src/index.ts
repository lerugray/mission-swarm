// MissionSwarm CLI entry point (ms-006).
//
// Wires argument parsing → audience loader → persona generator → round
// loop. Persists state.json per round. Streams reaction JSON lines to
// stdout.
//
// Subcommands:
//   run              Run a full simulation end-to-end.
//   list-audiences   Show registered audience profiles.
//   list-sims        Show completed / in-progress simulations in the sims dir.
//   summarize        Generate a post-simulation summary from a completed state.json.
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
import { parse as parseYaml } from "yaml";

import { generatePersonas } from "./personas";
import { resolveProvider } from "./providers/registry";
import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ProviderKind,
} from "./providers/types";
import { VALID_PROVIDER_KINDS } from "./providers/types";
import {
  reactionToReactionEvent,
  resetReactionEmitter,
  runSimulation,
  setReactionEmitter,
} from "./simulation";
import { summarizeSimulation } from "./summary";
import type {
  AudienceProfile,
  Reaction,
  ReactionEvent,
  SimulationState,
} from "./types";

const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_AUDIENCES_DIR = join(REPO_ROOT, "audiences");
const DEFAULT_SIMS_DIR =
  process.env.MISSIONSWARM_SIMS_DIR ?? join(REPO_ROOT, "simulations");

const KNOWN_SUBCOMMANDS = new Set([
  "run",
  "list-audiences",
  "list-sims",
  "summarize",
  "help",
]);

type OutputMode = "stream" | "json" | "sse";

// ─────────────────────────────────────────────────────────────
// Usage + main dispatcher
// ─────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`MissionSwarm — swarm-reaction simulation engine

Usage:
  missionswarm run [flags]        Run a full simulation
  missionswarm list-audiences     Show available audience profiles
  missionswarm list-sims          Show past simulations in the sims dir
  missionswarm summarize <sim>    Summarize a completed simulation
  missionswarm help               Show this message

Flags for 'run':
  --input=<path-or-text>          Input document: file path OR inline text.
                                  Paths tried first; if not a file, treated as text.
                                  REQUIRED.
  --audience=<id>                 Audience profile id (see list-audiences).
                                  REQUIRED.
  --agents=<n>                    Number of personas to generate. Default: 12.
  --personas=<n>                  Alias for --agents.
  --rounds=<n>                    Number of reaction rounds. Default: 5.
  --model=<id>                    Override MISSIONSWARM_LLM_MODEL for this run.
  --provider=<k>                  openrouter | ollama | claude (default: env-based).
  --output-mode=<m>               stream (default) | json | sse — stdout encoding.
  --output=<dir>                  Override simulations output directory
                                  (default: ./simulations or
                                  MISSIONSWARM_SIMS_DIR).
  --feed-window=<n>               Rounds of prior feed each persona sees. Default: 3.
  --dry-run                       Use a canned-response mock provider. No LLM calls.
  --simulation-id=<id>            Override generated simulation id (advanced).

  Shorthand: missionswarm <input-doc> --audience=<id> ...  (implicit 'run')

Environment:
  OPENROUTER_API_KEY              Cloud LLM provider (default preference).
  OLLAMA_BASE_URL                 Local LLM provider (fallback).
  MISSIONSWARM_LLM_MODEL          Model id (required for OpenRouter).
  MISSIONSWARM_SIMS_DIR           Simulations output directory.

Output:
  Per-simulation directory at <sims-dir>/<simulation-id>/ containing
  state.json and round-N.json per completed round. Reactions stream to
  stdout (default: one ReactionEvent JSON object per line). json mode
  buffers all events and prints a single array when the run finishes.
  sse mode emits Server-Sent Events frames.

Flags for 'summarize':
  <sim>                           REQUIRED. One of:
                                    - simulation-id (looks in --sims-dir / MISSIONSWARM_SIMS_DIR)
                                    - path to a simulation directory
                                    - path to a state.json file
  --model=<id>                    Override MISSIONSWARM_LLM_MODEL for this run.
  --sims-dir=<path>               Where to resolve sim-ids (default: ./simulations
                                  or MISSIONSWARM_SIMS_DIR).
  --output=<path>                 Where to write summary.md (default:
                                  <sim-dir>/summary.md).
  --dry-run                       Use a canned summary — no LLM call. Useful for
                                  verifying CLI wiring.
  --stdout                        Also print the full summary to stdout.`);
}

function printRunHelp(): void {
  console.log(`missionswarm run — full simulation

Required:
  --input=<path-or-text>     Input document (file path or inline text)
  --audience=<id>            Audience profile id (audiences/<id>.yaml|.json)

Common:
  --personas=<n> | --agents=<n>   Persona count (default 12)
  --rounds=<n>               Reaction rounds (default 5)
  --provider=openrouter|ollama|claude
  --model=<id>               Model id for the selected provider
  --output-mode=stream|json|sse
  --output=<dir>             simulations/ output directory
  --feed-window=<n>        Prior rounds visible in the feed (default 3)
  --simulation-id=<id>     Override generated run id
  --dry-run                  Mock LLM responses (no API keys)

Shorthand:
  missionswarm <input-doc> --audience=<id> [same flags as above]

See 'missionswarm help' for global environment variables.`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let sub = argv[0];
  let rest = argv.slice(1);

  if (
    sub !== undefined &&
    !sub.startsWith("-") &&
    !KNOWN_SUBCOMMANDS.has(sub)
  ) {
    rest = [`--input=${sub}`, ...rest];
    sub = "run";
  }

  switch (sub) {
    case "run":
      return runCmd(rest);
    case "list-audiences":
      return listAudiencesCmd();
    case "list-sims":
      return listSimsCmd(rest);
    case "summarize":
      return summarizeCmd(rest);
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
  provider?: ProviderKind;
  outputMode: OutputMode;
}

function parseOutputMode(raw: string): OutputMode | null {
  const v = raw.trim().toLowerCase();
  if (v === "stream" || v === "json" || v === "sse") return v;
  return null;
}

function parseRunFlags(argv: string[]): RunFlags {
  const f: RunFlags = {
    agents: 12,
    rounds: 5,
    feedWindow: 3,
    dryRun: false,
    outputMode: "stream",
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      f.dryRun = true;
      continue;
    }
    const eq = arg.indexOf("=");
    if (!arg.startsWith("--") || eq < 0) {
      console.error(`Unknown or malformed flag: ${arg}`);
      continue;
    }
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case "input":
        f.input = val;
        break;
      case "audience":
        f.audience = val;
        break;
      case "agents":
      case "personas":
        f.agents = Math.max(1, parseInt(val, 10) || 0);
        break;
      case "rounds":
        f.rounds = Math.max(1, parseInt(val, 10) || 0);
        break;
      case "model":
        f.model = val;
        break;
      case "output":
        f.output = val;
        break;
      case "feed-window":
        f.feedWindow = Math.max(1, parseInt(val, 10) || 0);
        break;
      case "simulation-id":
        f.simulationId = val;
        break;
      case "provider": {
        const k = val.trim().toLowerCase() as ProviderKind;
        if (!(VALID_PROVIDER_KINDS as readonly string[]).includes(k)) {
          console.error(
            `Unknown --provider=${val} (expected ${VALID_PROVIDER_KINDS.join(", ")})`,
          );
          break;
        }
        f.provider = k;
        break;
      }
      case "output-mode": {
        const m = parseOutputMode(val);
        if (!m) {
          console.error(`Unknown --output-mode=${val} (expected stream, json, sse)`);
          break;
        }
        f.outputMode = m;
        break;
      }
      default:
        console.error(`Unknown flag: --${key}`);
    }
  }
  return f;
}

async function runCmd(argv: string[]): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    printRunHelp();
    return 0;
  }

  const flags = parseRunFlags(argv);
  if (!flags.input) {
    console.error("run: --input is required");
    return 2;
  }
  if (!flags.audience) {
    console.error("run: --audience is required");
    return 2;
  }

  const jsonBuffer: ReactionEvent[] = [];

  try {
    const inputText = await resolveInputText(flags.input);
    const audience = await loadAudience(flags.audience);
    const provider = flags.dryRun
      ? createDryRunProvider()
      : resolveProvider({
          ...(flags.model ? { modelOverride: flags.model } : {}),
          ...(flags.provider ? { forceKind: flags.provider } : {}),
        });
    const simulationsDir = flags.output ?? DEFAULT_SIMS_DIR;
    const simulationId = flags.simulationId ?? generateSimulationId();

    process.stderr.write(
      `[missionswarm] starting sim ${simulationId} · audience=${audience.id} · ` +
        `agents=${flags.agents} · rounds=${flags.rounds} · ` +
        `provider=${provider.kind}${flags.dryRun ? " (dry-run)" : ""} · ` +
        `output-mode=${flags.outputMode}\n`,
    );

    const personas = await generatePersonas({
      simulationId,
      audience,
      inputDoc: inputText,
      nAgents: flags.agents,
      provider,
      ...(flags.model ? { chatOptions: { model: flags.model } } : {}),
    });

    process.stderr.write(
      `[missionswarm] personas generated (${personas.length}) · starting rounds\n`,
    );

    const emitForMode = (r: Reaction) => {
      const ev = reactionToReactionEvent(r, personas);
      if (flags.outputMode === "json") {
        jsonBuffer.push(ev);
        return;
      }
      const line = JSON.stringify(ev);
      if (flags.outputMode === "sse") {
        process.stdout.write(`event: reaction\ndata: ${line}\n\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    };

    setReactionEmitter(emitForMode);

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

    const chatOptions: ChatOptions | undefined = flags.model
      ? { model: flags.model }
      : undefined;

    const final = await runSimulation({
      state: baseState,
      provider,
      simulationsDir,
      feedWindowRounds: flags.feedWindow,
      ...(chatOptions ? { chatOptions } : {}),
    });

    if (flags.outputMode === "json") {
      process.stdout.write(JSON.stringify(jsonBuffer) + "\n");
    }

    process.stderr.write(
      `[missionswarm] ${final.status} · ${final.rounds.length}/${flags.rounds} rounds · ` +
        `state: ${join(simulationsDir, simulationId, "state.json")}\n`,
    );

    return final.status === "failed" ? 1 : 0;
  } finally {
    resetReactionEmitter();
  }
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
  const preferredPathByStem = new Map<string, { path: string; pri: number }>();
  for (const e of entries) {
    let stem: string;
    let pri: number;
    if (e.endsWith(".yaml")) {
      stem = e.slice(0, -".yaml".length);
      pri = 2;
    } else if (e.endsWith(".yml")) {
      stem = e.slice(0, -".yml".length);
      pri = 1;
    } else if (e.endsWith(".json")) {
      stem = e.slice(0, -".json".length);
      pri = 0;
    } else {
      continue;
    }
    const path = join(dir, e);
    const cur = preferredPathByStem.get(stem);
    if (!cur || pri > cur.pri) preferredPathByStem.set(stem, { path, pri });
  }
  const profiles: AudienceProfile[] = [];
  for (const { path } of preferredPathByStem.values()) {
    try {
      const raw = await readFile(path, "utf8");
      const p = (
        path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)
      ) as AudienceProfile;
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
// `summarize`
// ─────────────────────────────────────────────────────────────

interface SummarizeFlags {
  positional?: string;
  model?: string;
  simsDir?: string;
  output?: string;
  dryRun: boolean;
  alsoStdout: boolean;
}

function parseSummarizeFlags(argv: string[]): SummarizeFlags {
  const f: SummarizeFlags = { dryRun: false, alsoStdout: false };
  for (const arg of argv) {
    if (arg === "--dry-run") { f.dryRun = true; continue; }
    if (arg === "--stdout") { f.alsoStdout = true; continue; }
    if (!arg.startsWith("--")) {
      if (f.positional) {
        console.error(`summarize: multiple positional args, ignoring ${arg}`);
        continue;
      }
      f.positional = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq < 0) {
      console.error(`Unknown or malformed flag: ${arg}`);
      continue;
    }
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case "model": f.model = val; break;
      case "sims-dir": f.simsDir = val; break;
      case "output": f.output = val; break;
      default:
        console.error(`Unknown flag: --${key}`);
    }
  }
  return f;
}

/**
 * Resolve the summarize positional arg into { statePath, simDir }.
 *
 * Accepts:
 *   - a state.json file path → simDir = dirname
 *   - a simulation directory path → statePath = <dir>/state.json
 *   - a simulation id → statePath = <simsDir>/<id>/state.json
 */
async function resolveSimulationPaths(
  positional: string,
  simsDir: string,
): Promise<{ statePath: string; simDir: string }> {
  const { stat } = await import("node:fs/promises");

  if (existsSync(positional)) {
    const s = await stat(positional);
    if (s.isFile()) {
      return { statePath: positional, simDir: resolve(positional, "..") };
    }
    if (s.isDirectory()) {
      const p = join(positional, "state.json");
      if (!existsSync(p)) {
        throw new Error(`No state.json in ${positional}`);
      }
      return { statePath: p, simDir: positional };
    }
  }

  // Treat as sim-id
  const candidate = join(simsDir, positional);
  const statePath = join(candidate, "state.json");
  if (!existsSync(statePath)) {
    throw new Error(
      `Cannot resolve '${positional}' as a sim-id, path, or file. ` +
        `Looked at ${statePath} (sim-id resolution).`,
    );
  }
  return { statePath, simDir: candidate };
}

async function summarizeCmd(argv: string[]): Promise<number> {
  const flags = parseSummarizeFlags(argv);
  if (!flags.positional) {
    console.error("summarize: positional <sim> argument required");
    console.error(
      "Usage: missionswarm summarize <sim-id|sim-dir|state.json-path> [flags]",
    );
    return 2;
  }

  const simsDir = flags.simsDir ?? DEFAULT_SIMS_DIR;
  let statePath: string;
  let simDir: string;
  try {
    ({ statePath, simDir } = await resolveSimulationPaths(
      flags.positional,
      simsDir,
    ));
  } catch (e) {
    console.error(`summarize: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const raw = await readFile(statePath, "utf8");
  let state: SimulationState;
  try {
    state = JSON.parse(raw) as SimulationState;
  } catch (e) {
    console.error(
      `summarize: failed to parse ${statePath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }

  if (state.status !== "complete") {
    process.stderr.write(
      `[missionswarm] warning: state.status is '${state.status}', ` +
        `not 'complete'. Summarizing anyway — output may be partial.\n`,
    );
  }

  const provider = flags.dryRun
    ? createDryRunSummaryProvider(state)
    : resolveProvider(flags.model ? { modelOverride: flags.model } : {});

  process.stderr.write(
    `[missionswarm] summarizing ${state.id} · ${state.personas.length} personas · ` +
      `${state.rounds.length} rounds · provider=${provider.kind}${
        flags.dryRun ? " (dry-run)" : ""
      }\n`,
  );

  const summary = await summarizeSimulation(
    state,
    provider,
    flags.model ? { model: flags.model } : {},
  );

  const outputPath = flags.output ?? join(simDir, "summary.md");
  await writeAtomic(outputPath, summary);

  process.stderr.write(`[missionswarm] summary written to ${outputPath}\n`);
  if (flags.alsoStdout) {
    process.stdout.write(summary);
    if (!summary.endsWith("\n")) process.stdout.write("\n");
  }

  return 0;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const { writeFile, rename, mkdir } = await import("node:fs/promises");
  await mkdir(resolve(path, ".."), { recursive: true });
  const tmp = `${path}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

// ─────────────────────────────────────────────────────────────
// `list-sims`
// ─────────────────────────────────────────────────────────────

interface SimListFlags {
  simsDir?: string;
}

function parseListSimsFlags(argv: string[]): SimListFlags {
  const f: SimListFlags = {};
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    if (!arg.startsWith("--") || eq < 0) {
      console.error(`Unknown or malformed flag: ${arg}`);
      continue;
    }
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    if (key === "sims-dir") f.simsDir = val;
    else console.error(`Unknown flag: --${key}`);
  }
  return f;
}

interface SimRow {
  id: string;
  date: string;
  audience: string;
  agents: number;
  rounds: number;
  plannedRounds: number;
  status: string;
  hasSummary: boolean;
}

/**
 * Read a sim directory, extract the display-relevant fields from
 * state.json. Returns null if the dir doesn't contain a parseable
 * state.json (caller filters these out silently).
 */
export async function readSimRow(simDir: string, id: string): Promise<SimRow | null> {
  const statePath = join(simDir, "state.json");
  if (!existsSync(statePath)) return null;
  let state: SimulationState;
  try {
    const raw = await readFile(statePath, "utf8");
    state = JSON.parse(raw) as SimulationState;
  } catch {
    return null;
  }
  if (!state.id || !state.audience?.id || !Array.isArray(state.rounds)) {
    return null;
  }
  // Date heuristic: prefer started_at (ISO date prefix); fall back to
  // the sim-id timestamp if the id has one; else show "(unknown)".
  let date = "(unknown)";
  if (typeof state.started_at === "string" && state.started_at.length >= 10) {
    date = state.started_at.slice(0, 10);
  } else {
    const m = id.match(/\d{4}-\d{2}-\d{2}/);
    if (m) date = m[0];
  }
  return {
    id,
    date,
    audience: state.audience.id,
    agents: state.personas.length,
    rounds: state.rounds.length,
    plannedRounds: state.config?.n_rounds ?? state.rounds.length,
    status: state.status,
    hasSummary: existsSync(join(simDir, "summary.md")),
  };
}

export function formatSimRows(rows: SimRow[]): string {
  if (rows.length === 0) return "No simulations found.";
  const colWidths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    date: 10,
    audience: Math.max(8, ...rows.map((r) => r.audience.length)),
    size: 10,
    status: Math.max(6, ...rows.map((r) => r.status.length)),
  };
  const lines: string[] = [];
  lines.push(
    [
      "ID".padEnd(colWidths.id),
      "DATE".padEnd(colWidths.date),
      "AUDIENCE".padEnd(colWidths.audience),
      "SIZE".padEnd(colWidths.size),
      "STATUS".padEnd(colWidths.status),
      "SUMMARY",
    ].join("  "),
  );
  lines.push(
    [
      "-".repeat(colWidths.id),
      "-".repeat(colWidths.date),
      "-".repeat(colWidths.audience),
      "-".repeat(colWidths.size),
      "-".repeat(colWidths.status),
      "-------",
    ].join("  "),
  );
  for (const r of rows) {
    const size = `${r.agents}p x ${r.rounds}/${r.plannedRounds}r`;
    lines.push(
      [
        r.id.padEnd(colWidths.id),
        r.date.padEnd(colWidths.date),
        r.audience.padEnd(colWidths.audience),
        size.padEnd(colWidths.size),
        r.status.padEnd(colWidths.status),
        r.hasSummary ? "yes" : "no",
      ].join("  "),
    );
  }
  return lines.join("\n");
}

async function listSimsCmd(argv: string[]): Promise<number> {
  const flags = parseListSimsFlags(argv);
  const simsDir = flags.simsDir ?? DEFAULT_SIMS_DIR;
  if (!existsSync(simsDir)) {
    console.log(`No simulations directory at ${simsDir}.`);
    return 0;
  }
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(simsDir, { withFileTypes: true });
  const rows: SimRow[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const row = await readSimRow(join(simsDir, e.name), e.name);
    if (row) rows.push(row);
  }
  // Most recent first by date (string-sortable ISO prefix).
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  console.log(`Simulations in ${simsDir}:\n`);
  console.log(formatSimRows(rows));
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
  const base = join(DEFAULT_AUDIENCES_DIR, id);
  const candidates = [`${base}.yaml`, `${base}.yml`, `${base}.json`];
  let path: string | null = null;
  let raw = "";
  for (const p of candidates) {
    if (existsSync(p)) {
      path = p;
      raw = await readFile(p, "utf8");
      break;
    }
  }
  if (!path) {
    throw new Error(
      `Audience profile '${id}' not found (tried .yaml, .yml, .json under ${DEFAULT_AUDIENCES_DIR}). ` +
        `Run 'missionswarm list-audiences' to see available profiles.`,
    );
  }
  const parsed = (
    path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)
  ) as AudienceProfile;
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

function createDryRunSummaryProvider(state: SimulationState): LLMProvider {
  return {
    kind: "openrouter",
    id: "dry-run-summary",
    async *chat(): AsyncIterable<string> {
      const personaList = state.personas
        .map((p) => `- ${p.name}`)
        .join("\n");
      yield `## Input\n\n${state.resolved_input_doc.slice(0, 200)}${
        state.resolved_input_doc.length > 200 ? "..." : ""
      }\n\n## Reaction arc\n\n(dry-run) Canned summary. ${state.rounds.length} rounds recorded across ${state.personas.length} personas.\n\n## Active factions\n\n(dry-run) No clusters computed.\n\n## Notable voices\n\n${personaList}\n\n## Surprises\n\nNo significant stance drift against type this run.\n\n## Designer's takeaway\n\n(dry-run) Wiring verified; replace with live summarization for real output.\n`;
    },
  };
}

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

// Only run the CLI when this file is executed directly (not when
// imported by tests or another module). `import.meta.main` is a Bun
// primitive; falls back to the argv-matching heuristic elsewhere.
const runAsScript =
  (import.meta as { main?: boolean }).main === true ||
  (typeof process !== "undefined" && process.argv[1]?.endsWith("index.ts"));

if (runAsScript) {
  process.exit(await main());
}
