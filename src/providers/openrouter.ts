// MissionSwarm — OpenRouter provider (ms-002)
//
// HTTP streaming chat against openrouter.ai's OpenAI-compatible
// endpoint. SSE-framed (each `data:` line carries a JSON delta).
// Ported from mission-bullet's mb-002 with per-call timeout +
// network-error retry added per ms-002's spec.

import {
  ProviderRequestError,
  ProviderServerError,
  ProviderTimeoutError,
  ProviderTransportError,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
} from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export function createOpenRouterProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  return {
    kind: "openrouter",
    id: `openrouter:${config.model}`,
    async *chat(
      messages: ChatMessage[],
      options?: ChatOptions,
    ): AsyncIterable<string> {
      const model = options?.model ?? config.model;
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const payload: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };
      if (options?.temperature !== undefined) payload.temperature = options.temperature;
      if (options?.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
      const body = JSON.stringify(payload);

      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        if (options?.signal) {
          options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          let response: Response;
          try {
            response = await fetch(ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
                // Attribution — OpenRouter uses these for its
                // per-app rankings and dashboard.
                "HTTP-Referer": "https://github.com/lerugray/mission-swarm",
                "X-Title": "mission-swarm",
              },
              body,
              signal: controller.signal,
            });
          } catch (err) {
            if (controller.signal.aborted && !(options?.signal?.aborted ?? false)) {
              throw new ProviderTimeoutError(timeoutMs);
            }
            lastErr = err;
            if (attempt < MAX_RETRIES) continue;
            throw new ProviderTransportError(
              `OpenRouter fetch failed after ${attempt + 1} attempts: ${(err as Error).message}`,
              err,
            );
          }

          if (response.status >= 500 || response.status === 429) {
            // 429 (rate-limited) is also retry-able with backoff.
            // We don't backoff here — the single-retry gap suffices
            // for transient bursts; chronic 429 is a config problem.
            const errBody = await response.text().catch(() => "");
            lastErr = new ProviderServerError(
              response.status,
              `OpenRouter ${response.status} ${response.statusText}: ${errBody.slice(0, 300)}`,
            );
            if (attempt < MAX_RETRIES) continue;
            throw lastErr;
          }

          if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            throw new ProviderRequestError(
              response.status,
              `OpenRouter ${response.status} ${response.statusText}: ${errBody.slice(0, 300)}`,
            );
          }

          if (!response.body) {
            throw new ProviderTransportError("OpenRouter response missing body");
          }

          yield* consumeOpenRouterStream(response.body);
          return;
        } finally {
          clearTimeout(timer);
        }
      }
      throw new ProviderTransportError(
        `OpenRouter chat retries exhausted (${MAX_RETRIES + 1} attempts)`,
        lastErr,
      );
    },
  };
}

async function* consumeOpenRouterStream(
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
        if (!line || !line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Skip malformed SSE frames — upstream occasionally
          // sends keep-alive comments or partial JSON.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
