// MissionSwarm — round loop public surface (Phase 2).
//
// Re-exports streaming iteration + helpers. Programmatic embedders
// can use {@link runReactionLoop} with a bare input document + persona
// list without going through the full CLI state builder.

import type { ChatOptions, LLMProvider } from "./providers/types";
import type { AudienceProfile, Persona, ReactionEvent, SimulationState } from "./types";

import {
  iterateSimulation,
  reactionToReactionEvent,
  persistRoundJson,
  type RunSimulationInput,
} from "./simulation";

export {
  iterateSimulation,
  reactionToReactionEvent,
  persistRoundJson,
  type RunSimulationInput,
} from "./simulation";

export interface RunReactionLoopOptions {
  provider: LLMProvider;
  simulationsDir: string;
  simulationId: string;
  audience: AudienceProfile;
  feedWindowRounds?: number;
  chatOptions?: ChatOptions;
  /** Stored in state.config.input_doc (path or label). Default: "inline". */
  inputDocLabel?: string;
}

/**
 * Run the reaction loop from a resolved document + persona set.
 * Yields {@link ReactionEvent} per completed LLM reaction; returns final
 * {@link SimulationState} when the generator completes.
 */
export async function* runReactionLoop(
  inputDoc: string,
  personas: Persona[],
  rounds: number,
  options: RunReactionLoopOptions,
): AsyncGenerator<ReactionEvent, SimulationState> {
  const state: SimulationState = {
    id: options.simulationId,
    config: {
      input_doc: options.inputDocLabel ?? "inline",
      audience_profile_id: options.audience.id,
      n_agents: personas.length,
      n_rounds: rounds,
    },
    audience: options.audience,
    resolved_input_doc: inputDoc,
    personas,
    rounds: [],
    status: "pending",
    started_at: new Date().toISOString(),
  };

  const input: RunSimulationInput = {
    state,
    provider: options.provider,
    simulationsDir: options.simulationsDir,
    ...(options.feedWindowRounds !== undefined
      ? { feedWindowRounds: options.feedWindowRounds }
      : {}),
    ...(options.chatOptions ? { chatOptions: options.chatOptions } : {}),
  };

  const gen = iterateSimulation(input);
  while (true) {
    const step = await gen.next();
    if (step.done) {
      return step.value;
    }
    yield reactionToReactionEvent(step.value, state.personas);
  }
}
