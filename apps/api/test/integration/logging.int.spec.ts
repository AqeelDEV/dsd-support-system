import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureLogs, eventually, startApp } from "../support/app.js";

describe("request logging (NFR-5)", () => {
  const logs = captureLogs();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await startApp(
      { LOG_LEVEL: "info" },
      { logDestination: logs.stream },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs each request with its ID but never credentials, tokens or query strings", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/does-not-exist?token=QUERY-SECRET")
      .set("cookie", "dsd_staff_session=COOKIE-SECRET")
      .set("authorization", "Bearer HEADER-SECRET")
      .set("x-csrf-token", "CSRF-SECRET")
      .send({ email: "someone@example.com", password: "BODY-SECRET" })
      .expect(404);
    const requestId = response.headers["x-request-id"];

    await eventually(() => {
      expect(logs.text()).toContain(requestId);
    });
    const entry = logs
      .records()
      .find(
        (record) =>
          (record.req as { id?: string } | undefined)?.id === requestId,
      );
    expect(entry).toMatchObject({
      req: { method: "POST", path: "/api/v1/does-not-exist" },
      res: { statusCode: 404 },
    });
    expect(logs.text()).not.toMatch(/SECRET/);
  });

  it("doesn't log orchestrator health checks", async () => {
    const before = logs.records().length;
    await request(app.getHttpServer()).get("/health").expect(200);
    await request(app.getHttpServer()).get("/ready").expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const added = logs.records().slice(before);
    expect(added.filter((record) => record.req !== undefined)).toEqual([]);
  });
});
