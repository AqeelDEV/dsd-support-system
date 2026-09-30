import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PROBLEM_JSON, PROBLEM_TYPES, problemDetailsSchema } from "@dsd/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startApp } from "../support/app.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_ORIGIN = "https://tools.dsd.example";

describe("HTTP conventions", () => {
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startApp({ CORS_ORIGINS: ALLOWED_ORIGIN });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("errors", () => {
    it("answers an unknown route with problem details that carry the request ID", async () => {
      const response = await http().get("/api/v1/does-not-exist").expect(404);

      expect(response.headers["content-type"]).toContain(PROBLEM_JSON);
      const problem = problemDetailsSchema.parse(response.body);
      expect(problem).toMatchObject({
        type: PROBLEM_TYPES.blank,
        title: "Not Found",
        status: 404,
        instance: "/api/v1/does-not-exist",
      });
      expect(problem.requestId).toBe(response.headers["x-request-id"]);
    });

    it("answers malformed JSON with a 400 problem", async () => {
      const response = await http()
        .post("/api/v1/does-not-exist")
        .set("content-type", "application/json")
        .send("{not json")
        .expect(400);

      expect(response.headers["content-type"]).toContain(PROBLEM_JSON);
      expect(problemDetailsSchema.parse(response.body).status).toBe(400);
    });
  });

  describe("request IDs", () => {
    it("echoes a caller's UUID", async () => {
      const id = "0199a1b2-0000-7000-8000-0000000000aa";
      const response = await http()
        .get("/health")
        .set("x-request-id", id)
        .expect(200);
      expect(response.headers["x-request-id"]).toBe(id);
    });

    it("replaces anything that isn't a UUID", async () => {
      const response = await http()
        .get("/health")
        .set("x-request-id", "<script>alert(1)</script>")
        .expect(200);
      expect(response.headers["x-request-id"]).toMatch(UUID);
    });

    it("gives every response one, including errors", async () => {
      const response = await http().get("/api/v1/does-not-exist");
      expect(response.headers["x-request-id"]).toMatch(UUID);
    });
  });

  describe("versioning (API-2)", () => {
    it.each(["/api/v1/health", "/api/v1/ready", "/v1/health", "/tickets"])(
      "serves nothing at %s",
      async (path) => {
        await http().get(path).expect(404);
      },
    );
  });

  describe("security headers", () => {
    it("forbids framing and content sniffing", async () => {
      const response = await http().get("/health").expect(200);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    });

    it("sends HSTS only in production", async () => {
      const response = await http().get("/health").expect(200);
      expect(response.headers["strict-transport-security"]).toBeUndefined();
    });
  });

  describe("CORS", () => {
    it("allows a listed origin", async () => {
      const response = await http()
        .options("/health")
        .set("origin", ALLOWED_ORIGIN)
        .set("access-control-request-method", "GET");
      expect(response.headers["access-control-allow-origin"]).toBe(
        ALLOWED_ORIGIN,
      );
    });

    it("gives any other origin nothing to work with", async () => {
      const response = await http()
        .options("/health")
        .set("origin", "https://attacker.example")
        .set("access-control-request-method", "GET");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("API documentation (API-1)", () => {
    it("serves Swagger UI", async () => {
      const response = await http().get("/api/docs").expect(200);
      expect(response.headers["content-type"]).toContain("text/html");
    });

    it("serves the OpenAPI 3.1 document", async () => {
      const response = await http().get("/api/docs/openapi.json").expect(200);
      const document = response.body as {
        openapi: string;
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(document.openapi).toBe("3.1.0");
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining(["/health", "/ready"]),
      );
      expect(document.components.schemas).toHaveProperty("ProblemDetails");
    });
  });
});
