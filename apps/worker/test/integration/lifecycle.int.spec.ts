import net from "node:net";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { parseEnv } from "../../src/config/env.js";
import { createContainer, type Container } from "../../src/container.js";
import { createWorker, StartupError } from "../../src/lifecycle.js";
import { createLogger } from "../../src/logger.js";

/** Matches the development credentials in compose.yaml. */
const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.TEST_WORKER_DATABASE_URL ??
    "postgres://dsd_worker:worker-dev-password@127.0.0.1:55432/dsd",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379",
};

async function closedPort(): Promise<number> {
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

function capturedLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });
  return {
    logger: createLogger({ LOG_LEVEL: "info" }, stream),
    text: () => lines.join(""),
  };
}

describe("worker lifecycle", () => {
  let container: Container | undefined;

  afterEach(async () => {
    await container?.close();
    container = undefined;
  });

  it("starts once PostgreSQL and Redis answer, as the worker role, and stops cleanly", async () => {
    const env = parseEnv(TEST_ENV);
    const { logger, text } = capturedLogger();
    container = createContainer(env, logger);
    const worker = createWorker(env, container, logger);

    await worker.start();
    const { rows } = await container.pool.query<{ role: string }>(
      "SELECT current_user AS role",
    );
    expect(rows[0]?.role).toBe("dsd_worker");
    expect(text()).toContain("worker started");

    await worker.stop();
    await worker.stop();
    expect(container.redis.status).toBe("end");
    container = undefined;
  });

  it("gives up with a clear error when PostgreSQL stays unreachable", async () => {
    const port = await closedPort();
    const env = parseEnv({
      ...TEST_ENV,
      DATABASE_URL: `postgres://dsd_worker:x@127.0.0.1:${port}/dsd`,
      STARTUP_TIMEOUT_SECONDS: "1",
    });
    const { logger } = capturedLogger();
    container = createContainer(env, logger);

    await expect(createWorker(env, container, logger).start()).rejects.toThrow(
      StartupError,
    );
    await expect(createWorker(env, container, logger).start()).rejects.toThrow(
      /PostgreSQL/,
    );
  });
});
