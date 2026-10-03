import net from "node:net";
import { Writable } from "node:stream";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApp } from "../../src/app.factory.js";
import type { AppModuleOptions } from "../../src/app.module.js";
import { parseEnv } from "../../src/config/env.js";

/**
 * Defaults match the development credentials in compose.yaml, so tests run
 * against `docker compose up -d postgres redis` with no setup. CI uses the
 * same compose file.
 */
export const TEST_ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL:
    process.env.TEST_API_DATABASE_URL ??
    `postgres://dsd_api:api-dev-password@127.0.0.1:${process.env.POSTGRES_PORT ?? "15432"}/dsd`,
  REDIS_URL:
    process.env.TEST_REDIS_URL ??
    `redis://127.0.0.1:${process.env.REDIS_PORT ?? "16379"}`,
  TRUSTED_ORIGINS: "https://support.dsd.example,https://agents.dsd.example",
  AUTH_SECRET: "test-only-auth-secret-not-for-real-use",
  S3_ENDPOINT:
    process.env.TEST_S3_ENDPOINT ??
    `http://127.0.0.1:${process.env.S3_PORT ?? "18333"}`,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "dsd-dev-access-key",
  S3_SECRET_ACCESS_KEY:
    process.env.S3_SECRET_ACCESS_KEY ?? "dsd-dev-secret-key",
};

/** Builds the real application and readies it without opening a port. */
export async function startApp(
  overrides: Record<string, string> = {},
  options: AppModuleOptions = {},
): Promise<NestFastifyApplication> {
  const app = await createApp(parseEnv({ ...TEST_ENV, ...overrides }), options);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Nest buffers application logs until listen() flushes them. Tests never
  // listen, so flush here, or nothing logged through Nest's Logger appears.
  app.flushLogs();
  return app;
}

/** A local port that nothing listens on, to stand in for a dependency that is down. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

/** Collects log output so tests can assert on what was, and wasn't, logged. */
export function captureLogs() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const text = () => chunks.join("");
  const records = () =>
    text()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stream, text, records };
}

/** Polls until `check` passes or the timeout expires. */
export async function eventually(
  check: () => void,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
