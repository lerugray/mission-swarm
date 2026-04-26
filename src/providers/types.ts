// MissionSwarm — LLM provider abstraction (ms-002)
//
// Ported from mission-bullet's proven pattern (mb-002). Differences
// from mission-bullet:
//  - Provider kinds: "openrouter", "ollama", plus optional "claude"
//    (local Claude Code CLI subprocess) for subscription users.
//  - Default-provider preference inverted: mission-bullet prefers
//    Ollama-first for personal-data privacy. MissionSwarm prefers
//    OpenRouter-first because simulations are not personal data and
//    benefit from reliable cloud throughput. See registry.ts.
//  - Typed error hierarchy for retry/abort policy: simulation loop
//    distinguishes transport errors (retry-able) from config errors
//    (fatal) without string-matching.
//
// Shape is token-level streaming via AsyncIterable<string>. The
// round loop (ms-004) concatenates into full reactions. Streaming
// matters more here than it did for mission-bullet — simulations
// run N personas × R rounds LLM calls; letting earlier tokens
// surface while later ones are still generating shortens perceived
// latency.

export type ProviderKind = "openrouter" | "ollama" | "claude";

export const VALID_PROVIDER_KINDS: readonly ProviderKind[] = [
  "openrouter",
  "ollama",
  "claude",
];

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  /** Override the provider's configured model for this call. */
  model?: string;
  /** Sampling temperature. Provider-default if unset. */
  temperature?: number;
  /** Hard cap on response tokens. */
  maxTokens?: number;
  /** Abort signal for external cancellation (Ctrl-C, session end). */
  signal?: AbortSignal;
  /**
   * Per-call timeout in ms. If exceeded, the in-flight fetch is
   * aborted and the call throws ProviderTimeoutError. Defaults
   * to 60_000 (60s) — tuned for persona-reaction length, which
   * is usually <500 tokens. Very long generations should raise
   * this explicitly rather than relying on the default.
   */
  timeoutMs?: number;
}

export interface LLMProvider {
  kind: ProviderKind;
  /**
   * Human-readable identifier, e.g. "openrouter:anthropic/claude-sonnet-4-6"
   * or "ollama:llama3.1:8b". Used in state.json + logs so the reader
   * can tell which model emitted which reaction.
   */
  id: string;
  /**
   * Stream chat response tokens. Yields plain text fragments; the
   * caller concatenates. Throws typed errors on failure — see the
   * ProviderError hierarchy below.
   */
  chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string>;
}

// ─────────────────────────────────────────────────────────────
// Typed error hierarchy
// ─────────────────────────────────────────────────────────────

/** Base class — catch-all for provider-sourced errors. */
export class ProviderError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Transport-layer failure: network error, DNS, connection reset.
 * Retry-able per provider retry policy (see ollama.ts, openrouter.ts).
 * Simulation loop may additionally retry at higher level.
 */
export class ProviderTransportError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ProviderTransportError";
  }
}

/**
 * Request exceeded per-call timeout. Distinct from TransportError
 * because the cause is our client-side abort, not a network fault.
 * Sometimes retry-able (transient model queue), sometimes not
 * (prompt too large for model). Simulation loop decides.
 */
export class ProviderTimeoutError extends ProviderError {
  constructor(public timeoutMs: number, message?: string) {
    super(message ?? `Provider call exceeded ${timeoutMs}ms timeout`);
    this.name = "ProviderTimeoutError";
  }
}

/**
 * HTTP 4xx from upstream — usually config: wrong API key, invalid
 * model name, malformed request. Not retry-able at provider level.
 */
export class ProviderRequestError extends ProviderError {
  constructor(
    public status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ProviderRequestError";
  }
}

/**
 * HTTP 5xx from upstream or other server-side fault. Retry-able.
 */
export class ProviderServerError extends ProviderError {
  constructor(
    public status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ProviderServerError";
  }
}
