import Anthropic from "@anthropic-ai/sdk";

import type { LlmEffort } from "../settings.js";
import type { ChatModel, GenerateRequest, GenerateResult } from "./types.js";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Only for tests, which point the client at a local server. */
  baseUrl?: string;
}

/**
 * Server-side fallback in its `default` form: when a safety classifier
 * declines, the API re-runs the request on the model Anthropic recommends
 * for that kind of refusal, inside the same call. The default form is the
 * one Claude Sonnet 5.5 accepts on the Claude API.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Room for adaptive thinking plus a draft. A ceiling on cost, not a length
 * target: the draft itself is capped at 6,000 characters by the contract.
 */
const MAX_TOKENS = 16_000;

/** Anthropic has no `minimal`; the environment check refuses it for this provider. */
const EFFORTS: Record<
  Exclude<LlmEffort, "minimal">,
  "low" | "medium" | "high"
> = {
  low: "low",
  medium: "medium",
  high: "high",
};

/**
 * Claude, through Anthropic's official SDK (ADR-0006, section 2, amended
 * 2026-10-03; default model Claude Sonnet 5.5). The answer is constrained
 * to the reply contract's JSON Schema with structured outputs. Thinking is
 * left adaptive by omitting the parameter (disabling it is rejected on
 * Sonnet 5.5) and its depth is set with effort. No sampling settings are
 * sent, and the SDK never retries: the queue does.
 */
export class AnthropicChatModel implements ChatModel {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high" | null;

  constructor(options: AnthropicOptions, effort: LlmEffort | null) {
    if (effort === "minimal") {
      throw new Error("Anthropic models have no minimal effort; use low");
    }
    this.model = options.model;
    this.effort = effort === null ? null : EFFORTS[effort];
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs,
      ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: {
          format: { type: "json_schema", schema: { ...request.schema } },
          ...(this.effort === null ? {} : { effort: this.effort }),
        },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      },
      { signal: request.signal },
    );
    // The model that served the answer: a fallback model when one ran.
    const model = response.model;
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    if (response.stop_reason === "refusal") {
      return { kind: "refused", model, usage };
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    return { kind: "output", text, model, usage };
  }
}
