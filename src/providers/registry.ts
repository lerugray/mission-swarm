// MissionSwarm — provider registry + env-based default selection (ms-002)
//
// Resolves the active provider from environment:
//   OPENROUTER_API_KEY set → OpenRouter (default — cloud reliability)
//   else OLLAMA_BASE_URL set → Ollama (local)
//   else throw (no provider configured)
//
// MISSIONSWARM_LLM_MODEL supplies the model id (optional for Ollama
// if the server has a default configured; required for OpenRouter).
//
// Differs from mission-bullet's registry (which prefers Ollama-first
// because entries are personal data). Simulations don't carry
// personal data; OpenRouter-first gives simulations reliable cloud
// throughput without local-GPU cost.

import { createOllamaProvider } from "./ollama";
import { createOpenRouterProvider } from "./openrouter";
import { ProviderError, type LLMProvider } from "./types";

export interface ProviderResolveOptions {
  /** Override the MISSIONSWARM_LLM_MODEL env value. */
  modelOverride?: string;
  /**
   * Force a specific provider kind, bypassing env-based detection.
   * Useful for tests that want Ollama even when OPENROUTER_API_KEY
   * is set.
   */
  forceKind?: "openrouter" | "ollama";
}

export function resolveProvider(opts: ProviderResolveOptions = {}): LLMProvider {
  const env = process.env;
  const model = opts.modelOverride ?? env.MISSIONSWARM_LLM_MODEL;

  const openrouterKey = env.OPENROUTER_API_KEY?.trim();
  const ollamaBase = env.OLLAMA_BASE_URL?.trim();

  const wantOpenRouter =
    opts.forceKind === "openrouter" ||
    (opts.forceKind === undefined && openrouterKey);
  const wantOllama =
    opts.forceKind === "ollama" ||
    (opts.forceKind === undefined && !openrouterKey && ollamaBase);

  if (wantOpenRouter) {
    if (!openrouterKey) {
      throw new ProviderError(
        "Provider forced to openrouter but OPENROUTER_API_KEY is not set",
      );
    }
    if (!model) {
      throw new ProviderError(
        "OpenRouter provider requires a model (set MISSIONSWARM_LLM_MODEL, e.g. 'anthropic/claude-sonnet-4-6')",
      );
    }
    return createOpenRouterProvider({ apiKey: openrouterKey, model });
  }

  if (wantOllama) {
    if (!ollamaBase) {
      throw new ProviderError(
        "Provider forced to ollama but OLLAMA_BASE_URL is not set",
      );
    }
    return createOllamaProvider({
      baseUrl: ollamaBase,
      // Ollama can have a server-side default model if this is
      // empty; pass through undefined preserved via the create
      // function's signature requires a string, so we fall back
      // to a conventional default that most Ollama installs have.
      model: model ?? "llama3.1",
    });
  }

  throw new ProviderError(
    "No LLM provider configured. Set OPENROUTER_API_KEY (preferred) " +
      "or OLLAMA_BASE_URL to select a provider.",
  );
}
