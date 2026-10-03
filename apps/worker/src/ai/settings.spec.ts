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
        effort: null,
      },
      embeddings: {
        provider: "mock",
        model: "mock-hash-v1",
        timeoutMs: 30_000,
      },
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

  it("uses Gemini 3.5 Flash-Lite at low effort and Gemini Embedding 2 by default for Gemini", () => {
    const settings = aiSettings(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "gemini",
        EMBEDDINGS_PROVIDER: "gemini",
        GEMINI_API_KEY: "a-secret-key",
      }),
    );
    expect(settings.chat).toMatchObject({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      effort: "low",
    });
    expect(settings.embeddings).toMatchObject({
      provider: "gemini",
      model: "gemini-embedding-2",
    });
    expect(JSON.stringify(settings)).not.toContain("a-secret-key");
  });

  it("takes the effort from the environment, except for the mock, which doesn't reason", () => {
    const gemini = { ...REQUIRED, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" };
    expect(
      aiSettings(parseEnv({ ...gemini, LLM_EFFORT: "minimal" })).chat.effort,
    ).toBe("minimal");
    expect(
      aiSettings(parseEnv({ ...REQUIRED, LLM_EFFORT: "high" })).chat.effort,
    ).toBeNull();
  });

  it("uses Claude Sonnet 5.5 at medium effort by default for Anthropic, and text-embedding-3-small for OpenAI", () => {
    const settings = aiSettings(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "anthropic",
        EMBEDDINGS_PROVIDER: "openai",
        ANTHROPIC_API_KEY: "k",
        OPENAI_API_KEY: "k",
      }),
    );
    expect(settings.chat).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    expect(settings.embeddings).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
    });
  });

  it("sends OpenAI no effort unless one is set", () => {
    const openai = {
      ...REQUIRED,
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "k",
      LLM_MODEL: "gpt-test",
    };
    expect(aiSettings(parseEnv(openai)).chat).toMatchObject({
      model: "gpt-test",
      effort: null,
    });
    expect(
      aiSettings(parseEnv({ ...openai, LLM_EFFORT: "low" })).chat.effort,
    ).toBe("low");
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
