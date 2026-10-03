import { EMBEDDING_DIMENSIONS } from "@dsd/db/schema";
import {
  BlockedReason,
  FinishReason,
  type GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";

import type { LlmEffort } from "../settings.js";
import {
  type ChatModel,
  checkedVectors,
  type EmbeddingDocument,
  type EmbeddingModel,
  type GenerateRequest,
  type GenerateResult,
} from "./types.js";

/*
 * Gemini, through Google's official SDK (ADR-0006, section 2, amended
 * 2026-10-03). One API key covers both the chat model that drafts replies
 * and the embedding model that indexes the knowledge base.
 */

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Only for tests, which point the client at a local server. */
  baseUrl?: string;
}

function clientFor(options: GeminiOptions): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      timeout: options.timeoutMs,
      // One attempt: the queue retries the whole job with backoff
      // (ADR-0005, section 4), so retrying here too would multiply them.
      retryOptions: { attempts: 1 },
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    },
  });
}

const THINKING_LEVELS: Record<LlmEffort, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * Finish reasons that mean Google's checks stopped the answer. Asking again
 * gets the same answer, so they are refusals, not failures to retry.
 */
const BLOCKED: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

/** A ceiling on what one draft can cost, thinking included; far above a draft's length. */
const MAX_OUTPUT_TOKENS = 8_192;

function usageOf(response: GenerateContentResponse) {
  const usage = response.usageMetadata;
  if (usage === undefined) return null;
  return {
    inputTokens: usage.promptTokenCount ?? 0,
    // Thinking is billed as output.
    outputTokens:
      (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
}

/**
 * Drafts with `generateContent`: the fixed instructions as the system
 * instruction, the sources and ticket as the one user turn, and the answer
 * constrained to the reply contract's JSON Schema. No sampling settings are
 * sent; the model's defaults are what Google tunes it for.
 */
export class GeminiChatModel implements ChatModel {
  readonly provider = "gemini";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(
    options: GeminiOptions,
    private readonly effort: LlmEffort | null,
  ) {
    this.model = options.model;
    this.client = clientFor(options);
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: request.user }] }],
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(this.effort === null
          ? {}
          : {
              thinkingConfig: { thinkingLevel: THINKING_LEVELS[this.effort] },
            }),
        abortSignal: request.signal,
      },
    });
    const model = response.modelVersion ?? this.model;
    const usage = usageOf(response);
    const blockedPrompt =
      response.promptFeedback?.blockReason !== undefined &&
      response.promptFeedback.blockReason !==
        BlockedReason.BLOCKED_REASON_UNSPECIFIED;
    const finish = response.candidates?.[0]?.finishReason;
    if (blockedPrompt || (finish !== undefined && BLOCKED.has(finish))) {
      return { kind: "refused", model, usage };
    }
    return {
      kind: "output",
      // The answer's text parts, without any thoughts.
      text: response.text ?? "",
      model,
      usage: usage ?? { inputTokens: 0, outputTokens: 0 },
    };
  }
}

/**
 * Embeds with Gemini Embedding 2 at 1,024 dimensions. The model takes no
 * task type; instead documents and queries are written in the forms Google
 * documents for retrieval, so a question lands near the passage that
 * answers it rather than near other questions.
 */
export class GeminiEmbeddingModel implements EmbeddingModel {
  readonly provider = "gemini";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(options: GeminiOptions) {
    this.model = options.model;
    this.client = clientFor(options);
  }

  embedDocuments(documents: readonly EmbeddingDocument[]): Promise<number[][]> {
    return this.embed(
      documents.map(
        (document) =>
          `title: ${document.title || "none"} | text: ${document.text}`,
      ),
    );
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`task: search result | query: ${text}`]);
    if (vector === undefined) throw new Error(`${this.model} returned nothing`);
    return vector;
  }

  private async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.models.embedContent({
      model: this.model,
      // One Content per text. Plain strings passed together are taken as
      // the parts of one input and come back as a single embedding.
      contents: texts.map((text) => ({ role: "user", parts: [{ text }] })),
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    return checkedVectors(
      (response.embeddings ?? []).map((embedding) => embedding.values ?? []),
      texts.length,
      this.model,
    );
  }
}
