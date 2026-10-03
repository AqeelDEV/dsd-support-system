import { EMBEDDING_DIMENSIONS } from "@dsd/db/schema";
import OpenAI from "openai";

import type { LlmEffort } from "../settings.js";
import {
  type ChatModel,
  checkedVectors,
  type EmbeddingDocument,
  type EmbeddingModel,
  type GenerateRequest,
  type GenerateResult,
} from "./types.js";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Only for tests, which point the client at a local server. */
  baseUrl?: string;
}

function clientFor(options: OpenAiOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    // The queue retries the whole job with backoff (ADR-0005, section 4).
    maxRetries: 0,
    timeout: options.timeoutMs,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
  });
}

/** A ceiling on what one draft can cost, reasoning included. */
const MAX_OUTPUT_TOKENS = 8_192;

/**
 * Drafts with the Responses API, the answer constrained to the reply
 * contract's JSON Schema in strict mode. There is no default model: the
 * right one changes too often to guess, so `LLM_MODEL` is required.
 * Reasoning effort is sent only when `LLM_EFFORT` is set, because models
 * without reasoning reject it. Responses aren't stored at OpenAI.
 */
export class OpenAiChatModel implements ChatModel {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(
    options: OpenAiOptions,
    private readonly effort: LlmEffort | null,
  ) {
    this.model = options.model;
    this.client = clientFor(options);
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: request.system,
        input: request.user,
        text: {
          format: {
            type: "json_schema",
            name: "reply_draft",
            schema: { ...request.schema },
            strict: true,
          },
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        ...(this.effort === null ? {} : { reasoning: { effort: this.effort } }),
      },
      { signal: request.signal },
    );
    const usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      // Reasoning tokens are part of output_tokens.
      outputTokens: response.usage?.output_tokens ?? 0,
    };
    const refused =
      response.incomplete_details?.reason === "content_filter" ||
      response.output.some(
        (item) =>
          item.type === "message" &&
          item.content.some((part) => part.type === "refusal"),
      );
    if (refused) return { kind: "refused", model: response.model, usage };
    return {
      kind: "output",
      text: response.output_text,
      model: response.model,
      usage,
    };
  }
}

/**
 * Embeds with `text-embedding-3-small` (by default), shortened by the API
 * to 1,024 dimensions so it fits the index. The model takes documents and
 * queries alike, and a chunk's text already opens with its heading path,
 * which names the article, so the text is embedded as it is.
 */
export class OpenAiEmbeddingModel implements EmbeddingModel {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAiOptions) {
    this.model = options.model;
    this.client = clientFor(options);
  }

  embedDocuments(documents: readonly EmbeddingDocument[]): Promise<number[][]> {
    return this.embed(documents.map((document) => document.text));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    if (vector === undefined) throw new Error(`${this.model} returned nothing`);
    return vector;
  }

  private async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: [...texts],
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    return checkedVectors(
      ordered.map((item) => item.embedding),
      texts.length,
      this.model,
    );
  }
}
