import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { livenessSchema, readinessSchema } from "@dsd/shared";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { closedPort, startApp } from "../support/app.js";

describe("health endpoints", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("reports liveness without touching any dependency", async () => {
    const port = await closedPort();
    app = await startApp({
      DATABASE_URL: `postgres://dsd_api:x@127.0.0.1:${port}/dsd`,
      REDIS_URL: `redis://127.0.0.1:${port}`,
    });

    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);
    expect(livenessSchema.parse(response.body)).toEqual({ status: "ok" });
  });

  it("is ready when PostgreSQL and Redis both answer", async () => {
    app = await startApp();

    const response = await request(app.getHttpServer())
      .get("/ready")
      .expect(200);
    expect(readinessSchema.parse(response.body)).toEqual({
      status: "ok",
      checks: { database: "up", redis: "up" },
    });
  });

  it("stays in service, degraded, when only Redis is down", async () => {
    app = await startApp({
      REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
    });

    const response = await request(app.getHttpServer())
      .get("/ready")
      .expect(200);
    expect(readinessSchema.parse(response.body)).toEqual({
      status: "degraded",
      checks: { database: "up", redis: "down" },
    });
  });

  it("is unavailable when PostgreSQL is down", async () => {
    const port = await closedPort();
    app = await startApp({
      DATABASE_URL: `postgres://dsd_api:x@127.0.0.1:${port}/dsd`,
    });

    const response = await request(app.getHttpServer())
      .get("/ready")
      .expect(503);
    expect(readinessSchema.parse(response.body)).toEqual({
      status: "unavailable",
      checks: { database: "down", redis: "up" },
    });
  });
});
