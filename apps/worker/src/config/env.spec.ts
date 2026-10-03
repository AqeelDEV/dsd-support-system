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
