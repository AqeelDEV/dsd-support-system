import { createTestDatabase, type TestDatabase } from "@dsd/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createContainer, type Container } from "../../src/container.js";
import { CLEANUP_SCHEDULE, startJobs } from "../../src/jobs.js";
import { createWorker, StartupError } from "../../src/lifecycle.js";
import { capturedLogger, closedPort, testEnv } from "../support/worker.js";

describe("worker lifecycle", () => {
  let database: TestDatabase;
  let container: Container | undefined;

  beforeAll(async () => {
    database = await createTestDatabase("dsd_test_worker_lifecycle");
  });

  afterEach(async () => {
    await container?.close();
    container = undefined;
  });

  afterAll(async () => {
    await database.drop();
  });

  it("starts once PostgreSQL and Redis answer, as the worker role, and stops cleanly", async () => {
    const env = testEnv(database);
    const { logger, text } = capturedLogger();
    container = createContainer(env, logger);
    const worker = createWorker(env, container, logger);

    await worker.start();
    const { rows } = await container.pool.query<{ role: string }>(
      "SELECT current_user AS role",
    );
    expect(rows[0]?.role).toBe("dsd_worker");
    expect(text()).toContain("jobs started");
    expect(text()).toContain("worker started");

    await worker.stop();
    await worker.stop();
    expect(container.redis.status).toBe("end");
    expect(container.producer.status).toBe("end");
    container = undefined;
  });

  it("registers the nightly clean-up once, however often it starts", async () => {
    const env = testEnv(database);
    const { logger } = capturedLogger();
    container = createContainer(env, logger);
    const first = await startJobs(env, container, logger);
    await first.stop();
    const second = await startJobs(env, container, logger);
    try {
      const schedulers = await second.queues.maintenance.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        key: CLEANUP_SCHEDULE.id,
        pattern: CLEANUP_SCHEDULE.pattern,
        tz: "UTC",
      });
    } finally {
      await second.stop();
    }
  });

  it("gives up with a clear error when PostgreSQL stays unreachable", async () => {
    const port = await closedPort();
    const env = testEnv(database, {
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
