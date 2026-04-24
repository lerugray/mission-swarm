// MissionSwarm — Ollama provider (ms-002)
//
// HTTP streaming chat against a local Ollama server. ndjson-framed
// (one JSON object per newline). Ported from mission-bullet's
// mb-002 with per-call timeout + network-error retry added per
// ms-002's spec.

import {
  ProviderRequestError,
  ProviderServerError,
  ProviderTimeoutError,
  ProviderTransportError,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
} from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2; // 3 total attempts

export function createOllamaProvider(config: {
  baseUrl: string;
  model: string;
}): LLMProvider {
  const host = config.baseUrl.replace(/\/$/, "");
  return {
    kind: "ollama",
    id: `ollama:${config.model}`,
    async *chat(
      messages: ChatMessage[],
      options?: ChatOptions,
    ): AsyncIterable<string> {
      const model = options?.model ?? config.model;
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const ollamaOptions: Record<string, unknown> = {};
      if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
      if (options?.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;

      const body = JSON.stringify({
        model,
        messages,
        stream: true,
        options: ollamaOptions,
      });

      // Retry loop — only re-attempts on transport / 5xx errors.
      // 4xx + timeouts short-circuit on first hit.
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        // Compose external signal with internal timeout signal.
        if (options?.signal) {
          options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          let response: Response;
          try {
            response = await fetch(`${host}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              signal: controller.signal,
            });
          } catch (err) {
            if (controller.signal.aborted && !(options?.signal?.aborted ?? false)) {
              // Our timeout aborted the fetch — not retry-able here
              // (the round-loop may decide otherwise at its level).
              throw new ProviderTimeoutError(timeoutMs);
            }
            lastErr = err;
            if (attempt < MAX_RETRIES) continue;
            throw new ProviderTransportError(
              `Ollama fetch failed after ${attempt + 1} attempts: ${(err as Error).message}`,
              err,
            );
          }

          if (response.status >= 500) {
            const errBody = await response.text().catch(() => "");
            lastErr = new ProviderServerError(
              response.status,
              `Ollama ${response.status} ${response.statusText}: ${errBody.slice(0, 300)}`,
            );
            if (attempt < MAX_RETRIES) continue;
            throw lastErr;
          }

          if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            throw new ProviderRequestError(
              response.status,
              `Ollama ${response.status} ${response.statusText}: ${errBody.slice(0, 300)}`,
            );
          }

          if (!response.body) {
            throw new ProviderTransportError("Ollama response missing body");
          }

          // Stream successful — consume and yield, no more retries.
          yield* consumeOllamaStream(response.body);
          return;
        } finally {
          clearTimeout(timer);
        }
      }
      // Unreachable — the loop either yields+returns or throws.
      throw new ProviderTransportError(
        `Ollama chat retries exhausted (${MAX_RETRIES + 1} attempts)`,
        lastErr,
      );
    },
  };
}

async function* consumeOllamaStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx < 0) break;
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          const content = parsed.message?.content;
          if (content) yield content;
          if (parsed.done) return;
        } catch {
          // Ollama occasionally emits partial lines during
          // backpressure. Skip malformed frames rather than
          // crashing mid-stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
