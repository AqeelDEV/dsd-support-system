/*
 * The confidence gate (ADR-0006, section 5): before any chat model is
 * called, retrieval has to have found something that plausibly answers the
 * ticket. Fused RRF scores can't be compared from one query to the next,
 * so the gate reads the raw signals: the best cosine similarity, when
 * vectors are on, and the best keyword rank together with how many of the
 * query's words that chunk contains. Either one clearing its bar is
 * enough; when neither does, the ticket gets "no grounded suggestion" and
 * the model is never called.
 */

export interface Thresholds {
  /** Cosine similarity of the closest chunk, 0 to 1. */
  minVectorSimilarity: number;
  /** `ts_rank_cd` of the best keyword match, normalised to 0 to 1. */
  minKeywordRank: number;
  /** Distinct query words the best keyword match contains. */
  minMatchedTerms: number;
}

export interface RetrievalSignals {
  topVectorScore: number | null;
  topKeywordScore: number | null;
  topMatchedTerms: number | null;
}

/**
 * Thresholds per embedding model, picked with the evaluation set
 * (`pnpm --filter @dsd/worker eval --sweep`; docs/EVALUATION.md has the
 * numbers). The keyword bars don't depend on the model. A model without
 * an entry gets `UNTUNED`, a cautious guess to be replaced after running
 * the evaluation with it.
 */
export const KEYWORD_THRESHOLDS = {
  // A normalised rank of 0.5 is a raw ts_rank_cd of 1. Off-topic tickets
  // that share a few words with an article stay below it or match too few
  // of them; every answerable case in the set clears both.
  minKeywordRank: 0.5,
  minMatchedTerms: 3,
} as const;

export const VECTOR_THRESHOLDS: Readonly<Record<string, number>> = {
  // Off-topic cases score at most 0.19 and answerable ones at least 0.22.
  "mock-hash-v1": 0.2,
};

export const UNTUNED_VECTOR_THRESHOLD = 0.5;

export function thresholdsFor(
  embeddingModel: string | null,
  overrides: Partial<Thresholds> = {},
): Thresholds {
  return {
    minVectorSimilarity:
      overrides.minVectorSimilarity ??
      (embeddingModel === null
        ? UNTUNED_VECTOR_THRESHOLD
        : (VECTOR_THRESHOLDS[embeddingModel] ?? UNTUNED_VECTOR_THRESHOLD)),
    minKeywordRank:
      overrides.minKeywordRank ?? KEYWORD_THRESHOLDS.minKeywordRank,
    minMatchedTerms:
      overrides.minMatchedTerms ?? KEYWORD_THRESHOLDS.minMatchedTerms,
  };
}

export function isGrounded(
  signals: RetrievalSignals,
  thresholds: Thresholds,
): boolean {
  const vector =
    signals.topVectorScore !== null &&
    signals.topVectorScore >= thresholds.minVectorSimilarity;
  const keyword =
    signals.topKeywordScore !== null &&
    signals.topKeywordScore >= thresholds.minKeywordRank &&
    (signals.topMatchedTerms ?? 0) >= thresholds.minMatchedTerms;
  return vector || keyword;
}
