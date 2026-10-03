import { describe, expect, it } from "vitest";

import { ConfigError, parseEnv } from "./env.js";

const REQUIRED = {
  DATABASE_URL: "postgres://dsd_worker:pw@db:5432/dsd",
  REDIS_URL: "redis://redis:6379",
  SMTP_HOST: "mail.example.com",
  CUSTOMER_APP_URL: "https://help.example.com/",
  AGENT_APP_URL: "https://agents.example.com",
  S3_ENDPOINT: "http://store:8333",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    expect(parseEnv(REQUIRED)).toEqual({
      ...REQUIRED,
      CUSTOMER_APP_URL: "https://help.example.com",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      STARTUP_TIMEOUT_SECONDS: 60,
      QUEUE_PREFIX: "dsd-queues",
      OUTBOX_POLL_INTERVAL_MS: 500,
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      TICKET_BRAND_SLUG: "dsd",
      S3_REGION: "us-east-1",
      S3_BUCKET: "dsd-attachments",
      S3_FORCE_PATH_STYLE: true,
      LLM_PROVIDER: "mock",
      LLM_TIMEOUT_MS: 30_000,
      EMBEDDINGS_PROVIDER: "mock",
      MOCK_LLM_MODE: "grounded",
      AI_DEBOUNCE_MS: 10_000,
    });
  });

  it("runs AI suggestions offline unless told otherwise, reading empty values as unset", () => {
    expect(
      parseEnv({ ...REQUIRED, LLM_MODEL: "", EMBEDDINGS_MODEL: "" }),
    ).toMatchObject({
      LLM_PROVIDER: "mock",
      EMBEDDINGS_PROVIDER: "mock",
      LLM_MODEL: undefined,
      EMBEDDINGS_MODEL: undefined,
    });
    expect(
      parseEnv({ ...REQUIRED, EMBEDDINGS_PROVIDER: "none" }),
    ).toMatchObject({ EMBEDDINGS_PROVIDER: "none" });
    expect(() => parseEnv({ ...REQUIRED, LLM_PROVIDER: "magic" })).toThrow(
      /LLM_PROVIDER/,
    );
    expect(() => parseEnv({ ...REQUIRED, MOCK_LLM_MODE: "chaos" })).toThrow(
      /MOCK_LLM_MODE/,
    );
    expect(() => parseEnv({ ...REQUIRED, LLM_TIMEOUT_MS: "10" })).toThrow(
      /LLM_TIMEOUT_MS/,
    );
  });

  it("needs a provider's key only when that provider is in use", () => {
    expect(() => parseEnv({ ...REQUIRED, LLM_PROVIDER: "gemini" })).toThrow(
      /LLM_PROVIDER=gemini needs GEMINI_API_KEY/,
    );
    expect(() =>
      parseEnv({
        ...REQUIRED,
        EMBEDDINGS_PROVIDER: "gemini",
        GEMINI_API_KEY: "",
      }),
    ).toThrow(/EMBEDDINGS_PROVIDER=gemini needs GEMINI_API_KEY/);
    expect(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "gemini",
        EMBEDDINGS_PROVIDER: "gemini",
        GEMINI_API_KEY: "key",
        LLM_EFFORT: "medium",
      }),
    ).toMatchObject({
      LLM_PROVIDER: "gemini",
      EMBEDDINGS_PROVIDER: "gemini",
      LLM_EFFORT: "medium",
    });
    // A key nobody uses is no error, so one .env can switch providers.
    expect(parseEnv({ ...REQUIRED, GEMINI_API_KEY: "key" })).toMatchObject({
      LLM_PROVIDER: "mock",
    });
    expect(() => parseEnv({ ...REQUIRED, LLM_EFFORT: "max" })).toThrow(
      /LLM_EFFORT/,
    );
    expect(() => parseEnv({ ...REQUIRED, LLM_PROVIDER: "anthropic" })).toThrow(
      /LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY/,
    );
    expect(() =>
      parseEnv({ ...REQUIRED, EMBEDDINGS_PROVIDER: "openai" }),
    ).toThrow(/EMBEDDINGS_PROVIDER=openai needs OPENAI_API_KEY/);
  });

  it("requires a model for OpenAI, and refuses an effort Anthropic doesn't offer", () => {
    expect(() =>
      parseEnv({ ...REQUIRED, LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }),
    ).toThrow(/LLM_PROVIDER=openai needs LLM_MODEL/);
    expect(
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        LLM_MODEL: "gpt-test",
      }),
    ).toMatchObject({ LLM_MODEL: "gpt-test" });
    expect(() =>
      parseEnv({
        ...REQUIRED,
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "k",
        LLM_EFFORT: "minimal",
      }),
    ).toThrow(/no minimal effort/);
  });

  it("requires the connections, the mail server, the app URLs and the store", () => {
    expect(() => parseEnv({})).toThrow(ConfigError);
    for (const key of Object.keys(REQUIRED)) {
      expect(() => parseEnv({ ...REQUIRED, [key]: undefined })).toThrow(
        new RegExp(key),
      );
    }
  });

  it("takes SMTP credentials as a pair or not at all", () => {
    expect(() => parseEnv({ ...REQUIRED, SMTP_USER: "mailer" })).toThrow(
      /SMTP_PASSWORD/,
    );
    expect(
      parseEnv({ ...REQUIRED, SMTP_USER: "mailer", SMTP_PASSWORD: "pw" }),
    ).toMatchObject({ SMTP_USER: "mailer", SMTP_PASSWORD: "pw" });
  });
});
