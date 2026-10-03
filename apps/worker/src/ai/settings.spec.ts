import { describe, expect, it } from "vitest";

import { parseEnv } from "../config/env.js";
import { aiSettings } from "./settings.js";

const REQUIRED = {
  DATABASE_URL: "postgres://dsd_worker:pw@db:5432/dsd",
  REDIS_URL: "redis://redis:6379",
  SMTP_HOST: "mail.example.com",
  CUSTOMER_APP_URL: "https://help.example.com",
  AGENT_APP_URL: "https://agents.example.com",
  S3_ENDPOINT: "http://store:8333",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("aiSettings", () => {
  it("defaults to the offline mock for drafting and embedding", () => {
    expect(aiSettings(parseEnv(REQUIRED))).toEqual({
      chat: {
        provider: "mock",
        model: "mock-grounded-v1",
        timeoutMs: 30_000,
        mockMode: "grounded",
      },
      embeddings: { provider: "mock", model: "mock-hash-v1" },
      thresholds: {
        minVectorSimilarity: 0.3,
        minKeywordRank: 0.1,
        minMatchedTerms: 3,
      },
    });
  });

  it("lets the environment replace each confidence threshold", () => {
    expect(
      aiSettings(
        parseEnv({
          ...REQUIRED,
          AI_MIN_VECTOR_SIMILARITY: "0.42",
          AI_MIN_MATCHED_TERMS: "2",
        }),
      ).thresholds,
    ).toEqual({
      minVectorSimilarity: 0.42,
      minKeywordRank: 0.1,
      minMatchedTerms: 2,
    });
    expect(() =>
      parseEnv({ ...REQUIRED, AI_MIN_VECTOR_SIMILARITY: "1.5" }),
    ).toThrow(/AI_MIN_VECTOR_SIMILARITY/);
  });

  it("turns embeddings off with `none`, for keyword-only retrieval", () => {
    expect(
      aiSettings(parseEnv({ ...REQUIRED, EMBEDDINGS_PROVIDER: "none" }))
        .embeddings,
    ).toBeNull();
  });

  it("takes model names from the environment", () => {
    const settings = aiSettings(
      parseEnv({
        ...REQUIRED,
        LLM_MODEL: "mock-grounded-v2",
        EMBEDDINGS_MODEL: "mock-hash-v2",
      }),
    );
    expect(settings.chat.model).toBe("mock-grounded-v2");
    expect(settings.embeddings?.model).toBe("mock-hash-v2");
  });
});
