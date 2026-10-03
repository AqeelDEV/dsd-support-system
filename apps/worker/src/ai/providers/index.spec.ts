import { describe, expect, it } from "vitest";

import { parseEnv } from "../../config/env.js";
import { GeminiChatModel, GeminiEmbeddingModel } from "./gemini.js";
import { createModels } from "./index.js";
import { MockChatModel } from "./mock-chat.js";
import { MockEmbeddingModel } from "./mock-embeddings.js";

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

describe("createModels", () => {
  it("builds the offline mock by default", () => {
    const models = createModels(parseEnv(REQUIRED));
    expect(models.chat).toBeInstanceOf(MockChatModel);
    expect(models.embeddings).toBeInstanceOf(MockEmbeddingModel);
  });

  it("builds Gemini for either role, and no embedding model for `none`", () => {
    const models = createModels(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "gemini",
        EMBEDDINGS_PROVIDER: "gemini",
        GEMINI_API_KEY: "key",
      }),
    );
    expect(models.chat).toBeInstanceOf(GeminiChatModel);
    expect(models.chat.model).toBe("gemini-3.5-flash-lite");
    expect(models.embeddings).toBeInstanceOf(GeminiEmbeddingModel);
    expect(models.embeddings?.model).toBe("gemini-embedding-2");

    const keywordOnly = createModels(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "gemini",
        EMBEDDINGS_PROVIDER: "none",
        GEMINI_API_KEY: "key",
      }),
    );
    expect(keywordOnly.embeddings).toBeNull();
  });
});
