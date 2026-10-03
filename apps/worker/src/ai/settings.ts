import type { Env } from "../config/env.js";
import { type Thresholds, thresholdsFor } from "./retrieval/confidence.js";

/*
 * What the AI pipeline runs with, worked out once from the environment.
 * Model names are configuration, not code (ADR-0006, section 2): each
 * provider has a default here and `LLM_MODEL` or `EMBEDDINGS_MODEL`
 * replaces it.
 */

export type LlmProvider = Env["LLM_PROVIDER"];
export type MockLlmMode = Env["MOCK_LLM_MODE"];
export type EmbeddingsProvider = Exclude<Env["EMBEDDINGS_PROVIDER"], "none">;

export interface ChatSettings {
  provider: LlmProvider;
  model: string;
  timeoutMs: number;
  mockMode: MockLlmMode;
}

export interface EmbeddingSettings {
  provider: EmbeddingsProvider;
  model: string;
}

export interface AiSettings {
  chat: ChatSettings;
  /** Null when no embedding provider is configured: retrieval is keyword-only. */
  embeddings: EmbeddingSettings | null;
  /** The confidence gate's bars, for the configured embedding model. */
  thresholds: Thresholds;
}

const DEFAULT_CHAT_MODELS: Record<LlmProvider, string> = {
  mock: "mock-grounded-v1",
};

const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingsProvider, string> = {
  mock: "mock-hash-v1",
};

export function aiSettings(env: Env): AiSettings {
  const embeddings =
    env.EMBEDDINGS_PROVIDER === "none"
      ? null
      : {
          provider: env.EMBEDDINGS_PROVIDER,
          model:
            env.EMBEDDINGS_MODEL ??
            DEFAULT_EMBEDDING_MODELS[env.EMBEDDINGS_PROVIDER],
        };
  return {
    chat: {
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL ?? DEFAULT_CHAT_MODELS[env.LLM_PROVIDER],
      timeoutMs: env.LLM_TIMEOUT_MS,
      mockMode: env.MOCK_LLM_MODE,
    },
    embeddings,
    thresholds: thresholdsFor(embeddings?.model ?? null, {
      ...(env.AI_MIN_VECTOR_SIMILARITY === undefined
        ? {}
        : { minVectorSimilarity: env.AI_MIN_VECTOR_SIMILARITY }),
      ...(env.AI_MIN_KEYWORD_RANK === undefined
        ? {}
        : { minKeywordRank: env.AI_MIN_KEYWORD_RANK }),
      ...(env.AI_MIN_MATCHED_TERMS === undefined
        ? {}
        : { minMatchedTerms: env.AI_MIN_MATCHED_TERMS }),
    }),
  };
}
