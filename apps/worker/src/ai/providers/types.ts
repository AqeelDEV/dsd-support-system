import { EMBEDDING_DIMENSIONS } from "@dsd/db/schema";

/*
 * The two things the AI pipeline needs from a provider (ADR-0006, section
 * 2): a chat model that drafts a reply as JSON, and an embedding model that
 * turns text into vectors. Each provider is an adapter behind these
 * interfaces, so the pipeline never knows which one it is talking to.
 *
 * Adapters don't retry: a failed attempt throws, and the queue retries the
 * whole job with backoff (ADR-0005, section 4).
 */

/** One retrieved chunk as the prompt presents it. */
export interface PromptSource {
  /** Short and stable within one prompt: S1, S2, ... */
  id: string;
  title: string;
  headingPath: string;
  content: string;
}

export interface GenerateRequest {
  /** The fixed, versioned instructions. */
  system: string;
  /** The sources and the ticket, in delimited blocks. */
  user: string;
  /** JSON Schema of the answer, for providers that can constrain output to one. */
  schema: Readonly<Record<string, unknown>>;
  /**
   * The sources the prompt was built from. Real models read them in `user`;
   * the offline mock, which can't read prose, drafts from these instead.
   */
  sources: readonly PromptSource[];
  /** Aborted when the attempt has taken too long. */
  signal: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type GenerateResult =
  | {
      kind: "output";
      /** The model's answer as text: JSON if it followed instructions. */
      text: string;
      /** The model that answered, which may differ from the one asked (a provider fallback). */
      model: string;
      usage: TokenUsage;
    }
  | {
      /** The model or the provider's safety checks declined. Retrying won't change that. */
      kind: "refused";
      model: string;
      usage: TokenUsage | null;
    };

export interface ChatModel {
  /** For example `mock` or `gemini`; stored with every suggestion. */
  readonly provider: string;
  /** The configured model. */
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** A knowledge-base chunk to embed: the article title and the chunk's text. */
export interface EmbeddingDocument {
  title: string;
  text: string;
}

export interface EmbeddingModel {
  readonly provider: string;
  /** Stored with every vector; vectors from different models are never compared. */
  readonly model: string;
  /** One vector per document, in order. */
  embedDocuments(documents: readonly EmbeddingDocument[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/** What the worker runs AI suggestions with. */
export interface AiModels {
  chat: ChatModel;
  /** Null when no embedding provider is configured: retrieval is keyword-only. */
  embeddings: EmbeddingModel | null;
}

/**
 * Refuses vectors the index can't hold: the wrong number of them, the wrong
 * length, or values that aren't finite numbers. A provider answering with
 * another dimension fails the job loudly instead of corrupting the index.
 */
export function checkedVectors(
  vectors: readonly (readonly number[])[],
  expected: number,
  model: string,
): number[][] {
  if (vectors.length !== expected) {
    throw new Error(
      `${model} returned ${vectors.length} embeddings for ${expected} inputs`,
    );
  }
  return vectors.map((vector) => {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `${model} returned ${vector.length} dimensions; the index holds ${EMBEDDING_DIMENSIONS}`,
      );
    }
    if (!vector.every((value) => Number.isFinite(value))) {
      throw new Error(`${model} returned a vector with a non-finite value`);
    }
    return [...vector];
  });
}

/** A rough token count for providers that report none: about four characters per token. */
export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);
