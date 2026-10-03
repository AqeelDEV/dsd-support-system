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
export type LlmEffort = NonNullable<Env["LLM_EFFORT"]>;
export type EmbeddingsProvider = Exclude<Env["EMBEDDINGS_PROVIDER"], "none">;

export interface ChatSettings {
  provider: LlmProvider;
  model: string;
  timeoutMs: number;
  mockMode: MockLlmMode;
  /** Null for a provider that offers no choice. */
  effort: LlmEffort | null;
}

export interface EmbeddingSettings {
  provider: EmbeddingsProvider;
  model: string;
  timeoutMs: number;
}

export interface AiSettings {
  chat: ChatSettings;
  /** Null when no embedding provider is configured: retrieval is keyword-only. */
  embeddings: EmbeddingSettings | null;
  /** The confidence gate's bars, for the configured embedding model. */
  thresholds: Thresholds;
}

/**
 * The chat model when `LLM_MODEL` is unset (ADR-0006, amended 2026-10-03).
 * Gemini 3.5 Flash-Lite: the cheapest tier with constrained JSON output,
 * and a free tier for evaluation. Claude Sonnet 5.5: a short grounded draft
 * doesn't need Opus, and Sonnet is half the price and faster. OpenAI has
 * none; the environment check requires `LLM_MODEL` for it.
 */
const DEFAULT_CHAT_MODELS: Record<LlmProvider, string | null> = {
  mock: "mock-grounded-v1",
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-sonnet-5-5",
  openai: null,
};

/**
 * Effort when `LLM_EFFORT` is unset. A short grounded draft needs little
 * reasoning, and the agent is waiting for it.
 */
const DEFAULT_EFFORTS: Record<LlmProvider, LlmEffort | null> = {
  mock: null,
  gemini: "low",
  // Sonnet 5.5 defaults to high and its levels were recalibrated; medium is
  // a starting point, untuned until the evaluation runs with a key.
  anthropic: "medium",
  openai: null,
};

/** Each asked for 1,024 dimensions, so they fit the index (ADR-0006, amended). */
const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingsProvider, string> = {
  mock: "mock-hash-v1",
  gemini: "gemini-embedding-2",
  openai: "text-embedding-3-small",
};

function chatModelFor(env: Env): string {
  const model = env.LLM_MODEL ?? DEFAULT_CHAT_MODELS[env.LLM_PROVIDER];
  // The environment check already refuses this; here for the type.
  if (model === null) {
    throw new Error(`LLM_MODEL is required for ${env.LLM_PROVIDER}`);
  }
  return model;
}

/** How long one embedding request may take; a knowledge-base article is a handful of chunks. */
const EMBEDDING_TIMEOUT_MS = 30_000;

export function aiSettings(env: Env): AiSettings {
  const embeddings =
    env.EMBEDDINGS_PROVIDER === "none"
      ? null
      : {
          provider: env.EMBEDDINGS_PROVIDER,
          model:
            env.EMBEDDINGS_MODEL ??
            DEFAULT_EMBEDDING_MODELS[env.EMBEDDINGS_PROVIDER],
          timeoutMs: EMBEDDING_TIMEOUT_MS,
        };
  return {
    chat: {
      provider: env.LLM_PROVIDER,
      model: chatModelFor(env),
      timeoutMs: env.LLM_TIMEOUT_MS,
      mockMode: env.MOCK_LLM_MODE,
      // The mock doesn't reason, whatever the setting says.
      effort:
        env.LLM_PROVIDER === "mock"
          ? null
          : (env.LLM_EFFORT ?? DEFAULT_EFFORTS[env.LLM_PROVIDER]),
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
