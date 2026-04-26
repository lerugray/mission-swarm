// MissionSwarm — Claude Code CLI provider (optional subprocess).
//
// Invokes the `claude` binary on PATH (or MISSIONSWARM_CLAUDE_CMD) with
// a single user payload built from chat messages. Intended for users
// with a Claude Code subscription who prefer not to route sims through
// OpenRouter. The exact CLI flags may vary by Anthropic releases; the
// default uses `-p` (print) style invocation.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";

import {
  ProviderError,
  ProviderRequestError,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
} from "./types";

export interface ClaudeCliProviderConfig {
  /** Executable name or path. Default: MISSIONSWARM_CLAUDE_CMD or "claude". */
  command?: string;
}

function buildPrompt(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    parts.push(`[${m.role.toUpperCase()}]\n${m.content}`);
  }
  return parts.join("\n\n---\n\n");
}

export function createClaudeCliProvider(
  config: ClaudeCliProviderConfig = {},
): LLMProvider {
  const command =
    config.command?.trim() ||
    process.env.MISSIONSWARM_CLAUDE_CMD?.trim() ||
    "claude";

  return {
    kind: "claude",
    id: `claude-cli:${command}`,
    async *chat(
      messages: ChatMessage[],
      _options?: ChatOptions,
    ): AsyncIterable<string> {
      const prompt = buildPrompt(messages);
      const extraArgs = parseExtraArgs(process.env.MISSIONSWARM_CLAUDE_EXTRA_ARGS);
      const argv = [command, "-p", prompt, ...extraArgs];

      const child = spawn(argv[0]!, argv.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const stdout = child.stdout;
      if (!stdout) {
        throw new ProviderError("claude CLI: no stdout stream");
      }

      const outP = text(stdout);
      const [[code], out] = await Promise.all([
        once(child, "close") as Promise<[number | null]>,
        outP,
      ]);
      if (code !== 0) {
        throw new ProviderRequestError(
          code ?? 1,
          `claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`,
        );
      }
      if (out.length > 0) yield out;
    },
  };
}

function parseExtraArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}
